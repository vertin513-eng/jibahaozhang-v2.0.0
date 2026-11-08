// 开发用：通过 CDP 验证首次设置密码、解锁、错误锁定、指纹、安全设置与后台重新验证。
// 前置：headless Edge 监听 9222，python serve.py 监听 5178。
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
  const targetId = await newTarget('about:blank');
  const targets = await (await fetch(`${DEBUG}/json/list`)).json();
  const target = targets.find((t) => t.id === targetId);
  if (!target) throw new Error('target not found');

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
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
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
  // 浏览器没有原生指纹桥，注入一个只用于测试的 mock；不参与打包。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__bioMode = 'success';
      window.QHAndroid = {
        biometricStatus: function () { return 'ok'; },
        authenticateBiometric: function () {
          var mode = window.__bioMode;
          setTimeout(function () {
            if (!window.QHSecurity) return;
            if (mode === 'success') window.QHSecurity.onBiometricResult(true, '');
            else window.QHSecurity.onBiometricResult(false, 'fail');
          }, 130);
        }
      };
    `,
  });
  await send('Page.navigate', { url: URL_PAGE });
  await sleep(1600);
  // 每次测试从全新的本地数据开始，确保出现首次设置密码流程。
  await evalJs(`(function(){ localStorage.clear(); return true; })()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1800);
  await evalJs(`(function(){
    QH.Store.setSettings({ themeMode: 'light' });
    QHApp.render();
    return true;
  })()`);
  await sleep(350);

  const first = await evalJs(`(function(){
    return {
      mode: QHApp.state.auth && QHApp.state.auth.mode,
      authPage: !!document.querySelector('.auth-page'),
      home: !!document.querySelector('.page-home'),
      setup: QH.Security.needsSetup(),
      tabbar: document.getElementById('tabbar').style.display,
      dots: document.querySelectorAll('.pin-dot').length,
      bioOpt: !!document.querySelector('[data-action="auth-bio-opt"]')
    };
  })()`);
  console.log('first:', JSON.stringify(first));
  check('首次打开进入设置密码页', first.mode === 'setup' && first.authPage && !first.home, JSON.stringify(first));
  check('首次使用需要设置密码', first.setup === true, first.setup);
  check('解锁时隐藏底部导航', first.tabbar === 'none', first.tabbar);
  check('显示 6 个密码点', first.dots === 6, first.dots);
  await shot('shots/v190-security-setup.png');

  // 输入 123456，进入确认步骤。
  const step1 = await evalJs(`(async function(){
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '123456'[i] + '"]');
      if (!key) return 'no key ' + i;
      key.click();
      await new Promise(function (r) { setTimeout(r, 30); });
    }
    await new Promise(function (r) { setTimeout(r, 350); });
    return { step: QHApp.state.auth && QHApp.state.auth.step, busy: QHApp.state.auth && QHApp.state.auth.busy,
             bioOpt: !!document.querySelector('[data-action="auth-bio-opt"]') };
  })()`);
  console.log('pin-step1:', JSON.stringify(step1));
  check('输入 6 位后进入确认步骤', step1.step === 'confirm', JSON.stringify(step1));
  check('确认步骤显示指纹可选开关', step1.bioOpt === true, step1.bioOpt);
  await shot('shots/v190-security-confirm.png');

  // 打开指纹可选开关，再输入一遍。
  const setupDone = await evalJs(`(async function(){
    var bio = document.querySelector('[data-action="auth-bio-opt"]');
    if (bio) bio.click();
    await new Promise(function (r) { setTimeout(r, 80); });
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '123456'[i] + '"]');
      if (!key) return 'no key ' + i;
      key.click();
      await new Promise(function (r) { setTimeout(r, 30); });
    }
    await new Promise(function (r) { setTimeout(r, 700); });
    var sec = QH.Security.get();
    return { setupDone: sec.setupDone, enabled: sec.enabled, pin: sec.pinEnabled,
             bio: sec.biometricEnabled, auth: QHApp.state.auth,
             home: !!document.querySelector('.page-home'), hash: !!sec.pinHash, salt: !!sec.pinSalt };
  })()`);
  console.log('setup-done:', JSON.stringify(setupDone));
  check('设置完成后启用解锁', setupDone.setupDone && setupDone.enabled && setupDone.pin, JSON.stringify(setupDone));
  check('密码以哈希+盐保存', setupDone.hash && setupDone.salt, JSON.stringify(setupDone));
  check('指纹可选开关生效', setupDone.bio === true, setupDone.bio);
  check('设置完成进入首页', setupDone.auth === null && setupDone.home === true, JSON.stringify(setupDone));
  // 关掉可能弹出的新手引导，避免遮挡后续截图。
  await evalJs(`(function(){
    var skip = document.querySelector('[data-action="tutorial-close"]');
    if (skip) skip.click();
    return true;
  })()`);
  await sleep(400);

  // 手动锁定，检查解锁页与数据不可见。
  await evalJs(`(function(){
    document.getElementById('toast').className = 'toast';
    QHApp.lockNow('test');
    return true;
  })()`);
  await sleep(400);
  const locked = await evalJs(`(function(){
    return {
      auth: QHApp.state.auth && QHApp.state.auth.mode,
      authPage: !!document.querySelector('.auth-page'),
      home: !!document.querySelector('.page-home'),
      text: document.getElementById('view').textContent.slice(0, 60),
      bio: !!document.querySelector('[data-action="auth-biometric"]')
    };
  })()`);
  console.log('locked:', JSON.stringify(locked));
  check('锁定时进入解锁页', locked.auth === 'unlock' && locked.authPage && !locked.home, JSON.stringify(locked));
  check('锁定后不渲染账目页面', locked.text.indexOf('账户总余额') < 0, locked.text);
  check('同时开启密码和指纹时显示两个入口', locked.bio === true, locked.bio);
  await shot('shots/v190-security-unlock.png');

  // 连续输错 5 次，触发防暴力等待。
  const lockout = await evalJs(`(async function(){
    async function enter(code) {
      for (var i = 0; i < 6; i++) {
        var key = document.querySelector('[data-key="' + code[i] + '"]');
        if (!key) return false;
        key.click();
        await new Promise(function (r) { setTimeout(r, 18); });
      }
      await new Promise(function (r) { setTimeout(r, 350); });
      return true;
    }
    for (var n = 0; n < 5; n++) await enter('000000');
    var sec = QH.Security.get();
    return {
      attempts: sec.failedAttempts,
      remaining: QH.Security.lockRemainingMs(),
      lockText: (document.getElementById('auth-lock') || {}).textContent || '',
      disabled: document.querySelector('.pin-key[data-key="1"]').disabled
    };
  })()`);
  console.log('lockout:', JSON.stringify(lockout));
  check('输错 5 次后进入等待', lockout.attempts >= 5 && lockout.remaining > 0, JSON.stringify(lockout));
  check('锁定时显示倒计时', lockout.lockText.indexOf('等待') >= 0, lockout.lockText);
  check('锁定时键盘不可用', lockout.disabled === true, lockout.disabled);
  await shot('shots/v190-security-lockout.png');

  // 清掉等待，输入正确密码解锁。
  const unlocked = await evalJs(`(async function(){
    var sec = QH.Security.get();
    QH.Store.setSettings({ security: Object.assign({}, sec, { failedAttempts: 0, lockUntil: 0 }) });
    QHApp.render();
    await new Promise(function (r) { setTimeout(r, 120); });
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '123456'[i] + '"]');
      if (!key) return 'no key';
      key.click();
      await new Promise(function (r) { setTimeout(r, 25); });
    }
    await new Promise(function (r) { setTimeout(r, 650); });
    return { auth: QHApp.state.auth, home: !!document.querySelector('.page-home') };
  })()`);
  console.log('unlocked:', JSON.stringify(unlocked));
  check('正确密码解锁进入首页', unlocked.auth === null && unlocked.home === true, JSON.stringify(unlocked));

  // 后台锁定 + 指纹成功。
  const bioOk = await evalJs(`(async function(){
    window.__bioMode = 'success';
    QHApp.lockNow('background');
    await new Promise(function (r) { setTimeout(r, 100); });
    var btn = document.querySelector('[data-action="auth-biometric"]');
    if (!btn) return 'no bio button';
    btn.click();
    await new Promise(function (r) { setTimeout(r, 550); });
    return { auth: QHApp.state.auth, home: !!document.querySelector('.page-home') };
  })()`);
  console.log('bio-ok:', JSON.stringify(bioOk));
  check('指纹验证成功可解锁', bioOk.auth === null && bioOk.home === true, JSON.stringify(bioOk));

  // 指纹失败不进入。
  const bioFail = await evalJs(`(async function(){
    window.__bioMode = 'fail';
    QHApp.lockNow('background');
    await new Promise(function (r) { setTimeout(r, 100); });
    var btn = document.querySelector('[data-action="auth-biometric"]');
    if (!btn) return 'no bio button';
    btn.click();
    await new Promise(function (r) { setTimeout(r, 550); });
    return { auth: QHApp.state.auth && QHApp.state.auth.mode,
             home: !!document.querySelector('.page-home'),
             error: (document.querySelector('.auth-error') || {}).textContent || '' };
  })()`);
  console.log('bio-fail:', JSON.stringify(bioFail));
  check('指纹失败仍停留在解锁页', bioFail.auth === 'unlock' && bioFail.home === false, JSON.stringify(bioFail));
  check('指纹失败显示提示', bioFail.error.length > 0, bioFail.error);

  // 回到设置页所需的解锁：改用密码。
  await evalJs(`(async function(){
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '123456'[i] + '"]');
      if (key) key.click();
      await new Promise(function (r) { setTimeout(r, 25); });
    }
    await new Promise(function (r) { setTimeout(r, 650); });
    return true;
  })()`);

  // 模拟从后台返回：visibilitychange 应立即锁定。
  const bgLock = await evalJs(`(async function(){
    QHApp.state.hiddenAt = Date.now() - 1500;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(function (r) { setTimeout(r, 250); });
    return { auth: QHApp.state.auth && QHApp.state.auth.mode,
             home: !!document.querySelector('.page-home') };
  })()`);
  console.log('background-lock:', JSON.stringify(bgLock));
  check('从后台返回后重新锁定', bgLock.auth === 'unlock' && bgLock.home === false, JSON.stringify(bgLock));
  await evalJs(`(async function(){
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '123456'[i] + '"]');
      if (key) key.click();
      await new Promise(function (r) { setTimeout(r, 25); });
    }
    await new Promise(function (r) { setTimeout(r, 650); });
    return true;
  })()`);

  const secPage = await evalJs(`(function(){
    QHApp.goSecurity();
    return {
      route: QHApp.state.route.name,
      hero: (document.querySelector('.security-hero-main strong') || {}).textContent || '',
      rows: document.querySelectorAll('.security-switch-row').length,
      change: !!document.querySelector('[data-action="change-pin"]'),
      disable: !!document.querySelector('[data-action="disable-security"]')
    };
  })()`);
  console.log('sec-page:', JSON.stringify(secPage));
  check('我的页面可进入安全设置', secPage.route === 'security' && secPage.hero.indexOf('已开启') >= 0, JSON.stringify(secPage));
  check('有两种解锁方式开关', secPage.rows === 2, secPage.rows);
  check('提供修改密码入口', secPage.change === true, secPage.change);
  check('提供关闭验证入口', secPage.disable === true, secPage.disable);
  await sleep(400);
  await shot('shots/v190-security-settings.png');

  // 修改密码：当前 123456 -> 新 654321。
  const changed = await evalJs(`(async function(){
    document.querySelector('[data-action="change-pin"]').click();
    await new Promise(function (r) { setTimeout(r, 120); });
    async function enter(code) {
      for (var i = 0; i < 6; i++) {
        var key = document.querySelector('[data-key="' + code[i] + '"]');
        if (!key) return false;
        key.click();
        await new Promise(function (r) { setTimeout(r, 22); });
      }
      await new Promise(function (r) { setTimeout(r, 420); });
      return true;
    }
    if (QHApp.state.auth.step !== 'current') return 'not current';
    await enter('123456');
    if (QHApp.state.auth.step !== 'new') return 'not new';
    await enter('654321');
    if (QHApp.state.auth.step !== 'confirm') return 'not confirm';
    await enter('654321');
    await new Promise(function (r) { setTimeout(r, 600); });
    return { auth: QHApp.state.auth, route: QHApp.state.route.name,
             oldOk: (await QH.Security.verifyPin('123456')).ok,
             newOk: (await QH.Security.verifyPin('654321')).ok };
  })()`);
  console.log('changed:', JSON.stringify(changed));
  check('修改密码成功', changed.auth === null && changed.newOk === true && changed.oldOk === false, JSON.stringify(changed));

  // 关闭解锁验证：验证当前密码 654321。
  const disabled = await evalJs(`(async function(){
    document.querySelector('[data-action="disable-security"]').click();
    await new Promise(function (r) { setTimeout(r, 120); });
    for (var i = 0; i < 6; i++) {
      var key = document.querySelector('[data-key="' + '654321'[i] + '"]');
      if (!key) return 'no key';
      key.click();
      await new Promise(function (r) { setTimeout(r, 22); });
    }
    await new Promise(function (r) { setTimeout(r, 650); });
    var sec = QH.Security.get();
    return { auth: QHApp.state.auth, enabled: sec.enabled, setupDone: sec.setupDone,
             route: QHApp.state.route.name, hero: (document.querySelector('.security-hero-main strong') || {}).textContent || '' };
  })()`);
  console.log('disabled:', JSON.stringify(disabled));
  check('关闭解锁验证成功', disabled.auth === null && disabled.enabled === false && disabled.setupDone === true, JSON.stringify(disabled));
  check('关闭后显示未保护状态', disabled.hero.indexOf('已关闭') >= 0, disabled.hero);
  await sleep(400);
  await shot('shots/v190-security-disabled.png');

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n检查 ${checks.length} 项，失败 ${failed.length} 项`);
  if (failed.length) process.exitCode = 1;
  ws.close();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
