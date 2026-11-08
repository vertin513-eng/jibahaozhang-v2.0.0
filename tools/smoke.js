/* 自动化冒烟测试：在真实页面里跑数据层 + 关键交互，返回 JSON 字符串 */
(async function () {
  const S = QH.Store;
  const U = QH.Utils;
  const R = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chk = (name, cond, detail) => R.push({ name, ok: !!cond, detail: detail == null ? '' : String(detail) });
  const setVal = (el, val) => {
    const d = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    d.set.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const noOverflow = (label) => {
    const de = document.documentElement;
    chk(label + ' 无横向溢出', de.scrollWidth <= innerWidth + 1, de.scrollWidth + ' > ' + innerWidth);
  };

  const today = U.today();
  try {
    /* ---- 数据层 ---- */
    S.clearTransactions();
    S.setSettings({
      theme: 'matcha',
      themeMode: 'light',
      currency: '¥',
      reminders: {
        summary: { enabled: false, time: '21:00' },
        log: { enabled: false, time: '20:00' }
      }
    });
    S.setBudgets({ monthly: 0, categories: {} });
    S.setCalibration(U.parseYmd(today).getFullYear(), U.parseYmd(today).getMonth(), null);
    chk('清空后账单为 0', S.all().length === 0, S.all().length);

    const t1 = S.addTransaction({ type: 'expense', amount: 12.5, category: 'breakfast', note: '豆浆油条', date: today, time: '08:10' });
    const t2 = S.addTransaction({ type: 'expense', amount: 30, category: 'lunch', note: '', date: today, time: '12:30' });
    const t3 = S.addTransaction({ type: 'income', amount: 5000, category: 'income', note: '工资', date: today, time: '09:00' });
    const d1 = S.daySummary(today);
    chk('日汇总支出 42.50', d1.expense === 42.5, d1.expense);
    chk('日汇总收入 5000', d1.income === 5000, d1.income);
    chk('日汇总结余 4957.50', d1.balance === 4957.5, d1.balance);
    chk('日汇总 3 笔', d1.count === 3, d1.count);

    S.updateTransaction(t1.id, { amount: 15 });
    chk('修改金额后支出 45', S.daySummary(today).expense === 45, S.daySummary(today).expense);
    S.removeTransaction(t2.id);
    chk('删除后仅剩 2 笔', S.all().length === 2, S.all().length);
    chk('删除后支出 15', S.daySummary(today).expense === 15, S.daySummary(today).expense);
    chk('账单按时间倒序', S.sorted()[0].id === t3.id, S.sorted()[0].time);

    const rows = S.exportRows();
    chk('导出表头正确', rows[0].join(',') === '日期,时间,类型,账户,分类,金额,备注', rows[0].join(','));
    chk('CSV 非空', S.exportCSV().size > 100, S.exportCSV().size);
    chk('Excel 非空', S.exportExcel().size > 500, S.exportExcel().size);

    const backup = S.backupObject();
    const parsed = S.parseBackup(JSON.stringify(backup));
    chk('备份可解析', parsed.transactions.length === 2, parsed.transactions.length);

    S.setBudgets({ monthly: 1000, categories: { breakfast: 10 } });
    const bs = S.budgetStatus(U.parseYmd(today).getFullYear(), U.parseYmd(today).getMonth());
    chk('预算总额 1000', bs.total === 1000, bs.total);
    chk('预算已用 15', bs.spent === 15, bs.spent);
    chk('预算剩余 985', bs.remaining === 985, bs.remaining);
    chk('预算未超支', bs.over === false, bs.over);

    S.setReminder('summary', { enabled: true, time: '21:00' });
    chk('提醒设置持久化', S.getSettings().reminders.summary.enabled === true, JSON.stringify(S.getSettings().reminders.summary));

    /* ---- 首页 UI ---- */
    QHApp.goTab('home');
    await sleep(80);
    chk('首页仅两个主按钮', document.querySelectorAll('.home-actions .action-btn').length === 2, document.querySelectorAll('.home-actions .action-btn').length);
    chk('今日总结已从首页移除', !document.querySelector('.daily-card'), '');
    noOverflow('首页');

    QHApp.openCatPicker();
    await sleep(80);
    chk('记一笔先弹分类面板', document.querySelectorAll('.picker-item').length === 14, document.querySelectorAll('.picker-item').length);
    document.querySelector('.picker-item[data-cat="breakfast"]').click();
    await sleep(80);
    chk('选分类后进入金额面板', document.querySelector('#sheet-root').classList.contains('is-open') && !!document.getElementById('amount-input'), '');
    chk('面板标题为早餐', (document.querySelector('.sheet-cat strong') || {}).textContent === '早餐', '');
    const amountInput = document.getElementById('amount-input');
    setVal(amountInput, '9.9');
    document.getElementById('note-input').value = '茶叶蛋';
    document.querySelector('[data-action="save-tx"]').click();
    await sleep(120);
    chk('快捷记账新增 1 笔', S.all().length === 3, S.all().length);
    const added = S.all().find((t) => t.note === '茶叶蛋');
    chk('金额 9.90 分类早餐', added && added.amount === 9.9 && added.category === 'breakfast', added && added.amount);
    chk('记账后面板关闭', !document.querySelector('#sheet-root').classList.contains('is-open'), '');
    QHApp.goTab('calendar');
    await sleep(80);
    chk('日历日总结即时刷新', document.querySelector('.day-totals').textContent.indexOf('24.90') >= 0, document.querySelector('.day-totals').textContent.replace(/\s+/g, ' ').slice(0, 80));
    chk('日历日总结含分类明细', !!document.querySelector('.day-legend'), '');

    /* ---- 编辑 / 删除 ---- */
    QHApp.goDay(today);
    await sleep(80);
    chk('日详情渲染', !!document.querySelector('.detail-hero'), '');
    chk('日详情含编辑按钮', document.querySelectorAll('[data-action="edit-tx"]').length === 3, document.querySelectorAll('[data-action="edit-tx"]').length);
    noOverflow('日详情');

    document.querySelector('[data-action="edit-tx"][data-id="' + added.id + '"]').click();
    await sleep(80);
    chk('编辑面板回填金额', document.getElementById('amount-input').value === '9.9', document.getElementById('amount-input').value);
    setVal(document.getElementById('amount-input'), '19.9');
    document.querySelector('[data-action="save-tx"]').click();
    await sleep(120);
    chk('编辑保存成功', S.all().find((t) => t.id === added.id).amount === 19.9, S.all().find((t) => t.id === added.id).amount);

    document.querySelector('[data-action="delete-tx"][data-id="' + added.id + '"]').click();
    await sleep(60);
    chk('删除弹出确认框', document.querySelector('#modal-root').classList.contains('is-open'), '');
    document.querySelector('[data-action="modal-ok"]').click();
    await sleep(120);
    chk('确认后删除', S.all().length === 2, S.all().length);

    /* ---- 日历 ---- */
    QHApp.goTab('calendar');
    await sleep(100);
    chk('日历 42 格', document.querySelectorAll('.cal-cell').length === 42, document.querySelectorAll('.cal-cell').length);
    chk('今日有选中态', !!document.querySelector('.cal-cell.is-selected[data-date="' + today + '"]'), '');
    chk('日历有分类色点', document.querySelectorAll('.cal-dots i').length > 0, document.querySelectorAll('.cal-dots i').length);
    noOverflow('日历');
    document.querySelector('[data-action="cal-view"][data-value="week"]').click();
    await sleep(80);
    chk('切换周视图', document.querySelectorAll('.week-cell').length === 7, document.querySelectorAll('.week-cell').length);
    document.querySelector('[data-action="cal-view"][data-value="month"]').click();
    await sleep(80);
    const other = document.querySelector('.cal-cell:not(.is-out):not(.is-selected)');
    const otherDate = other && other.dataset.date;
    other.click();
    await sleep(80);
    chk('点选日期切换明细', document.querySelector('.cal-cell.is-selected').dataset.date === otherDate, otherDate);
    chk('日面板标题跟随', (document.querySelector('.day-panel h2') || {}).textContent.indexOf(U.monthDayLabel(otherDate)) >= 0, (document.querySelector('.day-panel h2') || {}).textContent);

    /* ---- 统计 ---- */
    QHApp.goTab('stats');
    await sleep(100);
    chk('统计四个汇总卡', document.querySelectorAll('.stat-cell').length === 4, document.querySelectorAll('.stat-cell').length);
    chk('统计有环形图', !!document.querySelector('.donut svg'), '');
    chk('统计有折线图', !!document.querySelector('.line-chart svg'), '');
    chk('三餐专项统计存在', document.body.textContent.indexOf('三餐专项统计') >= 0, '');
    noOverflow('统计');
    document.querySelector('[data-action="stats-mode"][data-value="week"]').click();
    await sleep(80);
    chk('切到周统计', document.querySelector('[data-action="stats-mode"][data-value="week"]').classList.contains('is-active'), '');
    chk('周统计有数据', document.querySelector('.stat-cell strong').textContent.indexOf('¥') >= 0, document.querySelector('.stat-cell strong').textContent);

    /* ---- 预算 ---- */
    QHApp.goTab('home');
    await sleep(80);
    document.querySelector('.budget-strip').click();
    await sleep(100);
    chk('进入预算页', !!document.getElementById('budget-form'), '');
    chk('预算页有可自由分配卡', !!document.getElementById('alloc-card'), '');
    chk('预算页分类行不竖排', document.querySelector('.budget-row-title span').getBoundingClientRect().width > 24, document.querySelector('.budget-row-title span').getBoundingClientRect().width);
    noOverflow('预算');
    const form = document.getElementById('budget-form');
    form.elements.monthly.value = '2000';
    form.elements.cat_breakfast.value = '150';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await sleep(120);
    chk('预算保存成功', S.getBudgets().monthly === 2000 && S.getBudgets().categories.breakfast === 150, JSON.stringify(S.getBudgets()));

    /* ---- 设置 ---- */
    QHApp.goTab('me');
    await sleep(100);
    chk('主题色 5 套', document.querySelectorAll('.swatch').length === 5, document.querySelectorAll('.swatch').length);
    chk('提醒开关键存在', document.querySelectorAll('[data-action="toggle-reminder"]').length === 5, document.querySelectorAll('[data-action="toggle-reminder"]').length);
    noOverflow('我的');
    document.querySelector('[data-action="set-theme"][data-theme="ocean"]').click();
    await sleep(80);
    chk('切换主题为海盐蓝', getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() === '#4A84A6', getComputedStyle(document.documentElement).getPropertyValue('--primary'));
    document.querySelector('[data-action="set-mode"][data-value="dark"]').click();
    await sleep(80);
    chk('切换深色模式', document.documentElement.getAttribute('data-mode') === 'dark', document.documentElement.getAttribute('data-mode'));
    document.querySelector('[data-action="set-mode"][data-value="light"]').click();
    await sleep(60);
    chk('切回浅色模式', document.documentElement.getAttribute('data-mode') === 'light', document.documentElement.getAttribute('data-mode'));

    const cur = document.querySelector('[data-currency]');
    cur.value = '$';
    cur.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(80);
    chk('货币单位保存', S.getSettings().currency === '$', S.getSettings().currency);

    const sw = document.querySelector('[data-action="toggle-reminder"][data-kind="log"]');
    sw.click();
    await sleep(80);
    chk('记账提醒开关生效', S.getSettings().reminders.log.enabled === true, S.getSettings().reminders.log.enabled);

    /* ---- 备份还原 ---- */
    const snapshot = JSON.stringify(S.backupObject());
    S.clearTransactions();
    chk('清空全部账单', S.all().length === 0, S.all().length);
    S.restore(S.parseBackup(snapshot));
    chk('备份还原账单数', S.all().length === 2, S.all().length);
    chk('备份还原后预算保留', S.getBudgets().monthly === 2000, S.getBudgets().monthly);

    /* ---- 收尾：恢复默认外观，清理测试数据 ---- */
    S.setSettings({
      theme: 'matcha',
      themeMode: 'light',
      currency: '¥',
      reminders: {
        summary: { enabled: false, time: '21:00' },
        log: { enabled: false, time: '20:00' }
      }
    });
    S.setBudgets({ monthly: 0, categories: {} });
    S.clearTransactions();
    QHApp.goTab('home');
    await sleep(60);

    return JSON.stringify({ pass: R.filter((r) => r.ok).length, fail: R.filter((r) => !r.ok).length, results: R });
  } catch (e) {
    return JSON.stringify({ pass: R.filter((r) => r.ok).length, fail: R.filter((r) => !r.ok).length + 1, error: String(e && e.stack ? e.stack : e), results: R });
  }
})()
