// 开发用：通过 CDP 在真实页面执行 tools/smoke.js，输出通过/失败明细。
import fs from 'node:fs';

const DEBUG = 'http://127.0.0.1:9222';
const script = fs.readFileSync(new URL('./smoke.js', import.meta.url), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch(`${DEBUG}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const { id } = await res.json();
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
    const id = ++mid;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result ? r.result.value : undefined;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844,
  });
  await send('Page.navigate', { url: process.env.PAGE_URL || 'http://127.0.0.1:5178/index.html?empty=1' });
  await sleep(1200);
  await evalJs(`(async()=>{try{
    const rs=await navigator.serviceWorker.getRegistrations();
    await Promise.all(rs.map(r=>r.unregister()));
    const ks=await caches.keys(); await Promise.all(ks.map(k=>caches.delete(k)));
  }catch(e){} return 'cleared';})()`, true);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1200);

  // 冒烟测试不测安全模块：临时关闭本机解锁，专注原有 66 项功能。
  await evalJs(`(function(){
    try {
      if (window.QH && QH.Security && QHApp && (QH.Security.needsSetup() || QH.Security.isLocked())) {
        QH.Store.setSettings({ security: {
          setupDone: true, enabled: false, pinEnabled: false, biometricEnabled: false,
          pinHash: '', pinSalt: '', failedAttempts: 0, lockUntil: 0
        }});
        QH.Security.init();
        QHApp.state.auth = null;
        QHApp.render();
      }
    } catch (e) {}
    return true;
  })()`, false);
  await sleep(250);

  const raw = await evalJs(script, true);
  ws.close();

  let data;
  try { data = JSON.parse(raw); } catch (e) {
    console.error('无法解析测试输出：', raw);
    process.exitCode = 2;
    return;
  }
  console.log(`通过 ${data.pass} 项，失败 ${data.fail} 项`);
  if (data.error) console.log('异常：', String(data.error).slice(0, 1200));
  for (const r of data.results || []) {
    if (!r.ok) console.log(`  ✗ ${r.name}  ${r.detail || ''}`);
  }
  process.exitCode = data.fail === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
