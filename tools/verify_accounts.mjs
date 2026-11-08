// 开发用：多账户、转账、账户统计筛选的端到端验证。
import fs from 'node:fs';

const DEBUG = 'http://127.0.0.1:9222';
const URL_PAGE = process.env.PAGE_URL || 'http://127.0.0.1:5178/index.html?empty';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  if (!ok) console.log('  ✗', name, detail == null ? '' : detail);
}

async function newTarget(url) {
  const res = await fetch(`${DEBUG}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`new target failed: ${res.status}`);
  return (await res.json()).id;
}

async function main() {
  const id = await newTarget('about:blank');
  const targets = await (await fetch(`${DEBUG}/json/list`)).json();
  const target = targets.find((t) => t.id === id);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let mid = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result || {});
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++mid;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  };
  const shot = async (path) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path, Buffer.from(data, 'base64'));
    console.log('screenshot:', path);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await send('Page.navigate', { url: URL_PAGE });
  await sleep(1600);
  await evalJs(`(function(){ localStorage.clear(); return true; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1600);

  // 关闭安全模块，专注多账户；同时把主题固定为浅色。
  await evalJs(`(function(){
    QH.Store.setSettings({ themeMode: 'light', security: {
      setupDone: true, enabled: false, pinEnabled: false, biometricEnabled: false,
      pinHash: '', pinSalt: '', failedAttempts: 0, lockUntil: 0
    }});
    QH.Security.init();
    QHApp.state.auth = null;
    QH.Store.clearTransactions();
    QH.Store.setBudgets({ monthly: 2000, categories: {} });
    QHApp.render();
    return true;
  })()`);
  await sleep(300);

  const fresh = await evalJs(`(function(){
    var list = QH.Store.accounts();
    return { count: list.length, names: list.map(function(a){return a.name;}), ids: list.map(function(a){return a.id;}),
             total: QH.Store.accountsSummary().total };
  })()`);
  console.log('fresh:', JSON.stringify(fresh));
  check('默认 3 个账户', fresh.count === 3, fresh.count);
  check('默认账户为微信/支付宝/银行卡', fresh.names.join(',') === '微信,支付宝,银行卡', fresh.names);
  check('新账户总资产 0', fresh.total === 0, fresh.total);

  const setup = await evalJs(`(function(){
    var U = QH.Utils;
    var d = function(n){ return U.ymd(U.addDays(U.parseYmd(U.today()), n)); };
    QH.Store.setAccountOpening('wechat', 1000, d(-10));
    QH.Store.setAccountOpening('alipay', 500, d(-5));
    QH.Store.setAccountOpening('bank', 2000, d(-20));
    QH.Store.addTransaction({type:'expense',accountId:'wechat',category:'lunch',amount:100,note:'微信午饭',date:d(-2),time:'12:00'});
    QH.Store.addTransaction({type:'income',accountId:'wechat',category:'income',amount:50,note:'微信红包',date:d(-1),time:'09:00'});
    QH.Store.addTransaction({type:'expense',accountId:'alipay',category:'shopping',amount:200,note:'支付宝购物',date:U.today(),time:'10:00'});
    QHApp.state.balanceVisible = false;
    QHApp.goTab('home');
    var sum = QH.Store.accountsSummary();
    return { total: sum.total, balances: sum.accounts.map(function(a){return [a.id,a.balance];}),
             cardValue: document.querySelector('.balance-value').textContent,
             cardSub: document.querySelector('.balance-strip .strip-main > span').textContent };
  })()`);
  console.log('setup:', JSON.stringify(setup));
  check('总资产 = 1000+500+2000-100+50-200 = 3250', setup.total === 3250, setup.total);
  check('微信余额 950', JSON.stringify(setup.balances).indexOf('["wechat",950]') >= 0, JSON.stringify(setup.balances));
  check('支付宝余额 300', JSON.stringify(setup.balances).indexOf('["alipay",300]') >= 0, JSON.stringify(setup.balances));
  check('银行卡余额 2000', JSON.stringify(setup.balances).indexOf('["bank",2000]') >= 0, JSON.stringify(setup.balances));
  check('首页总资产默认打码', setup.cardValue === '****', setup.cardValue);
  check('首页副标题显示账户数', setup.cardSub.indexOf('3 个账户') >= 0, setup.cardSub);
  await sleep(400);
  await shot('shots/v200-home-total.png');

  const reveal = await evalJs(`(function(){
    document.querySelector('.balance-eye').click();
    return { value: document.querySelector('.balance-value').textContent };
  })()`);
  check('点眼睛显示总资产', reveal.value === '¥3,250.00', reveal.value);

  const homeClick = await evalJs(`(function(){
    document.querySelector('.balance-strip').click();
    return QHApp.state.route.name;
  })()`);
  console.log('home-click:', homeClick);
  check('点击总账余额进入账户总览', homeClick === 'accounts', homeClick);

  const accountsPage = await evalJs(`(function(){
    QHApp.goAccounts();
    return { route: QHApp.state.route.name,
             total: (document.querySelector('.accounts-total')||{}).textContent || '',
             rows: document.querySelectorAll('.account-open').length,
             names: Array.from(document.querySelectorAll('.account-row-main strong')).map(function(e){return e.textContent;}) };
  })()`);
  console.log('accounts-page:', JSON.stringify(accountsPage));
  check('总资产卡片可进入账户总览', accountsPage.route === 'accounts', accountsPage.route);
  check('账户总览展示所有子账户', accountsPage.rows === 3, accountsPage.rows);
  check('账户总览顶部显示总资产', accountsPage.total === '¥3,250.00', accountsPage.total);
  check('账户总览显示账户名称', accountsPage.names.join(',') === '微信,支付宝,银行卡', accountsPage.names);
  await sleep(350);
  await shot('shots/v200-accounts.png');

  const detail = await evalJs(`(function(){
    QHApp.goAccount('wechat');
    return { route: QHApp.state.route.name,
             balance: (document.querySelector('.account-hero-balance')||{}).textContent || '',
             rows: document.querySelectorAll('.tx-row').length,
             transferRows: document.querySelectorAll('.tx-amt.transfer').length };
  })()`);
  console.log('detail:', JSON.stringify(detail));
  check('账户明细页打开', detail.route === 'account', detail.route);
  check('账户明细显示该账户余额', detail.balance === '¥950.00', detail.balance);
  check('账户明细只显示该账户流水', detail.rows === 2, detail.rows);
  await sleep(350);
  await shot('shots/v200-account-detail.png');

  const transferDirect = await evalJs(`(function(){
    var before = QH.Store.accountsSummary().total;
    var tx = QH.Store.addTransaction({type:'transfer',fromAccountId:'wechat',toAccountId:'bank',amount:200,note:'还信用卡',date:QH.Utils.today(),time:'11:00'});
    var sum = QH.Store.accountsSummary();
    var s = QH.Store.summarize(QH.Store.all());
    return { before: before, after: sum.total, type: tx.type,
             balances: sum.accounts.map(function(a){return [a.id,a.balance];}),
             income: s.income, expense: s.expense };
  })()`);
  console.log('transfer-direct:', JSON.stringify(transferDirect));
  check('转账类型为 transfer', transferDirect.type === 'transfer', transferDirect.type);
  check('转账不改变总资产', transferDirect.before === transferDirect.after, transferDirect.before + ' / ' + transferDirect.after);
  check('转账后微信 750 / 银行卡 2200', JSON.stringify(transferDirect.balances).indexOf('["wechat",750]') >= 0 && JSON.stringify(transferDirect.balances).indexOf('["bank",2200]') >= 0, JSON.stringify(transferDirect.balances));
  check('转账不计入收入支出', transferDirect.income === 50 && transferDirect.expense === 300, transferDirect.income + '/' + transferDirect.expense);

  const transferUI = await evalJs(`(async function(){
    QHApp.goAccounts();
    await new Promise(function(r){setTimeout(r,80);});
    document.querySelector('[data-action="open-transfer"]').click();
    await new Promise(function(r){setTimeout(r,120);});
    var sheet = !!document.querySelector('.transfer-sheet');
    var fromChips = document.querySelectorAll('[data-action="transfer-from"]').length;
    var toChips = document.querySelectorAll('[data-action="transfer-to"]').length;
    document.querySelector('[data-action="transfer-from"][data-account="alipay"]').click();
    await new Promise(function(r){setTimeout(r,60);});
    document.querySelector('[data-action="transfer-to"][data-account="bank"]').click();
    await new Promise(function(r){setTimeout(r,60);});
    var amount = document.getElementById('transfer-amount');
    amount.value = '50';
    amount.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-transfer"]').click();
    await new Promise(function(r){setTimeout(r,250);});
    var sum = QH.Store.accountsSummary();
    return { sheet: sheet, fromChips: fromChips, toChips: toChips,
             open: document.getElementById('sheet-root').classList.contains('is-open'),
             total: sum.total, balances: sum.accounts.map(function(a){return [a.id,a.balance];}) };
  })()`);
  console.log('transfer-ui:', JSON.stringify(transferUI));
  check('转账面板可选择两个账户', transferUI.sheet && transferUI.fromChips === 3 && transferUI.toChips === 3, JSON.stringify(transferUI));
  check('界面转账后总资产不变', transferUI.total === 3250, transferUI.total);
  check('界面转账后支付宝 250 / 银行卡 2250', JSON.stringify(transferUI.balances).indexOf('["alipay",250]') >= 0 && JSON.stringify(transferUI.balances).indexOf('["bank",2250]') >= 0, JSON.stringify(transferUI.balances));
  check('保存后转账面板关闭', transferUI.open === false, transferUI.open);

  const transferRows = await evalJs(`(function(){
    QHApp.goAccount('wechat');
    var wechatRows = Array.from(document.querySelectorAll('.tx-amt.transfer')).map(function(e){return e.textContent;});
    QHApp.goAccount('bank');
    var bankRows = Array.from(document.querySelectorAll('.tx-amt.transfer')).map(function(e){return e.textContent;});
    QHApp.goAccounts();
    return { wechat: wechatRows, bank: bankRows };
  })()`);
  console.log('transfer-rows:', JSON.stringify(transferRows));
  check('账户明细显示转出', transferRows.wechat.length === 1 && transferRows.wechat[0] === '−¥200.00', JSON.stringify(transferRows.wechat));
  check('账户明细显示转入', transferRows.bank.length === 2 && transferRows.bank.indexOf('+¥200.00') >= 0 && transferRows.bank.indexOf('+¥50.00') >= 0, JSON.stringify(transferRows.bank));

  const editTransfer = await evalJs(`(async function(){
    QHApp.goAccount('wechat');
    var btn = document.querySelector('.tx-row.is-transfer [data-action="edit-transfer"]');
    if (!btn) return 'no edit button';
    btn.click();
    await new Promise(function(r){setTimeout(r,120);});
    var input = document.getElementById('transfer-amount');
    input.value = '100';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-transfer"]').click();
    await new Promise(function(r){setTimeout(r,250);});
    var sum = QH.Store.accountsSummary();
    return { total: sum.total, balances: sum.accounts.map(function(a){return [a.id,a.balance];}) };
  })()`);
  console.log('edit-transfer:', JSON.stringify(editTransfer));
  check('转账记录可以修改', editTransfer.total === 3250 && JSON.stringify(editTransfer.balances).indexOf('["wechat",850]') >= 0 && JSON.stringify(editTransfer.balances).indexOf('["bank",2150]') >= 0, JSON.stringify(editTransfer));

  await evalJs(`(function(){ QHApp.goAccounts(); return true; })()`);
  await sleep(300);
  await evalJs(`(function(){ document.querySelector('[data-action="open-transfer"]').click(); return true; })()`);
  await sleep(350);
  await shot('shots/v200-transfer.png');
  await evalJs(`(function(){ document.querySelector('[data-action="close-transfer"]').click(); return true; })()`);
  await sleep(250);

  const addAccount = await evalJs(`(async function(){
    QHApp.goAccounts();
    await new Promise(function(r){setTimeout(r,80);});
    document.querySelector('[data-action="add-account"]').click();
    await new Promise(function(r){setTimeout(r,100);});
    var input = document.getElementById('account-name-input');
    input.value = '现金';
    input.dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="account-icon"][data-icon="bag"]').click();
    await new Promise(function(r){setTimeout(r,60);});
    document.querySelector('[data-action="save-account"]').click();
    await new Promise(function(r){setTimeout(r,250);});
    var list = QH.Store.accounts();
    return { count: list.length, last: list[list.length-1].name, route: QHApp.state.route.name,
             total: QH.Store.accountsSummary().total };
  })()`);
  console.log('add-account:', JSON.stringify(addAccount));
  check('可以新增账户', addAccount.count === 4 && addAccount.last === '现金', JSON.stringify(addAccount));
  check('新增账户不改变总资产', addAccount.total === 3250, addAccount.total);

  const txForm = await evalJs(`(async function(){
    QHApp.openAdd('lunch','expense',QH.Utils.today());
    await new Promise(function(r){setTimeout(r,120);});
    var chips = document.querySelectorAll('[data-action="sheet-account"]').length;
    document.querySelector('[data-action="sheet-account"][data-account="alipay"]').click();
    await new Promise(function(r){setTimeout(r,80);});
    var amount = document.getElementById('amount-input');
    amount.value = '30';
    amount.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('note-input').value = '支付宝午饭';
    document.querySelector('[data-action="save-tx"]').click();
    await new Promise(function(r){setTimeout(r,250);});
    var tx = QH.Store.all().filter(function(t){return t.note==='支付宝午饭';})[0];
    return { chips: chips, accountId: tx && tx.accountId, balances: QH.Store.accountsSummary().accounts.map(function(a){return [a.id,a.balance];}) };
  })()`);
  console.log('tx-form:', JSON.stringify(txForm));
  check('记账面板每个账户都可选', txForm.chips === 4, txForm.chips);
  check('支出记录保存到指定账户', txForm.accountId === 'alipay', txForm.accountId);
  check('支出使支付宝余额减少', JSON.stringify(txForm.balances).indexOf('["alipay",220]') >= 0, JSON.stringify(txForm.balances));

  const stats = await evalJs(`(function(){
    QHApp.goTab('stats');
    var allActive = (document.querySelector('[data-action="stats-account"][data-account="all"]')||{}).className || '';
    var totalText = (document.querySelector('.stat-summary')||{}).textContent || '';
    document.querySelector('[data-action="stats-account"][data-account="wechat"]').click();
    var wechatText = (document.querySelector('.stat-summary')||{}).textContent || '';
    return { allActive: allActive.indexOf('is-active') >= 0, totalText: totalText,
             accountId: QHApp.state.stats.accountId, wechatText: wechatText,
             hasCumulative: !!document.querySelector('.cum-card'),
             hasScope: !!document.querySelector('.stats-account-scope') };
  })()`);
  console.log('stats:', JSON.stringify(stats));
  check('统计默认看总账', stats.allActive === true, stats.allActive);
  check('统计可切换单账户', stats.accountId === 'wechat' && stats.hasScope === true, JSON.stringify(stats));
  check('单账户统计隐藏总账预算卡', stats.hasCumulative === false, stats.hasCumulative);
  await sleep(350);
  await shot('shots/v200-stats-account.png');

  const exportCheck = await evalJs(`(function(){
    var rows = QH.Store.exportRows();
    return { header: rows[0].join(','), transfer: rows.filter(function(r){return r[2]==='转账';}).length };
  })()`);
  console.log('export:', JSON.stringify(exportCheck));
  check('导出包含账户列', exportCheck.header === '日期,时间,类型,账户,分类,金额,备注', exportCheck.header);
  check('导出包含转账记录', exportCheck.transfer === 2, exportCheck.transfer);

  const backup = await evalJs(`(function(){
    var obj = QH.Store.backupObject();
    var parsed = QH.Store.parseBackup(JSON.stringify(obj));
    return { accounts: (obj.data.accounts||[]).length, parsedAccounts: (parsed.accounts||[]).length,
             total: QH.Store.accountsSummary().total };
  })()`);
  console.log('backup:', JSON.stringify(backup));
  check('备份包含账户', backup.accounts === 4 && backup.parsedAccounts === 4, JSON.stringify(backup));

  const legacy = await evalJs(`(function(){
    var obj = { data: {
      transactions: [{type:'expense', category:'lunch', amount:10, date:'2026-01-01', time:'12:00', note:'旧账单'}],
      settings: { accountInitialBalance: 100, accountStartDate: '2026-01-01' },
      categories: QH.Store.CATEGORIES,
      budgets: { monthly: 0, categories: {}, calibrations: {}, monthlyHistory: {} },
      meta: {}
    }};
    var m = QH.Store.parseBackup(JSON.stringify(obj));
    var bank = m.accounts.filter(function(a){return a.id==='bank';})[0];
    return { count: m.accounts.length, bankInitial: bank.initialBalance, bankStart: bank.startDate,
             txAccount: m.transactions[0].accountId, hasSecurity: !!(m.settings && m.settings.security) };
  })()`);
  console.log('legacy:', JSON.stringify(legacy));
  check('旧单账户数据迁移为 3 个账户', legacy.count === 3, legacy.count);
  check('旧初始余额迁移到银行卡', legacy.bankInitial === 100 && legacy.bankStart === '2026-01-01', JSON.stringify(legacy));
  check('旧账单归入银行卡', legacy.txAccount === 'bank', legacy.txAccount);

  const noSecurityInBackup = await evalJs(`(function(){
    var data = QH.Store.backupObject().data;
    return !(data.settings && data.settings.security);
  })()`);
  check('备份不包含解锁密码哈希', noSecurityInBackup === true, noSecurityInBackup);

  const accountSettings = await evalJs(`(async function(){
    var a = QH.Store.accounts()[QH.Store.accounts().length - 1];
    QHApp.goAccount(a.id);
    document.querySelector('[data-action="edit-account"]').click();
    await new Promise(function(r){setTimeout(r,100);});
    var name = document.getElementById('account-name-input');
    name.value = '现金钱包';
    document.querySelector('[data-action="save-account"]').click();
    await new Promise(function(r){setTimeout(r,200);});
    var renamed = QH.Store.accountById(a.id).name;
    document.querySelector('[data-action="edit-account-opening"]').click();
    await new Promise(function(r){setTimeout(r,120);});
    var openingOpen = document.getElementById('sheet-root').classList.contains('is-open');
    var initial = document.getElementById('balance-input').value;
    document.getElementById('balance-input').value = '600';
    document.getElementById('balance-input').dispatchEvent(new Event('input',{bubbles:true}));
    document.querySelector('[data-action="save-balance"]').click();
    await new Promise(function(r){setTimeout(r,220);});
    return { renamed: renamed, openingOpen: openingOpen, initial: initial,
             balance: QH.Store.accountSummary(a.id).balance,
             total: QH.Store.accountsSummary().total,
             route: QHApp.state.route.name };
  })()`);
  console.log('account-settings:', JSON.stringify(accountSettings));
  check('可以编辑账户名称', accountSettings.renamed === '现金钱包', accountSettings.renamed);
  check('可以设置账户初始余额', accountSettings.openingOpen === true && accountSettings.initial === '0' && accountSettings.balance === 600, JSON.stringify(accountSettings));
  check('账户初始余额计入总资产', accountSettings.total === 3820, accountSettings.total);
  await sleep(300);
  await shot('shots/v200-account-settings.png');

  await evalJs(`(function(){ QHApp.openAdd('lunch','expense',QH.Utils.today()); return true; })()`);
  await sleep(400);
  await shot('shots/v200-tx-account.png');
  await evalJs(`(function(){ document.querySelector('[data-action="close-sheet"]').click(); return true; })()`);
  await sleep(250);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n检查 ${checks.length} 项，失败 ${failed.length} 项`);
  if (failed.length) process.exitCode = 1;
  ws.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
