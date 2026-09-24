#!/usr/bin/env node
/**
 * 在页面里跑一段 JS 并把结果打出来。
 * 排查「某个按钮点了没反应」这类问题时，比每次都写一个新脚本快得多。
 *
 * 用法：
 *   node tools/eval-page.js <url> --js="<表达式>" [--wait=8000] [--cookie=pbl_session=xxx]
 *
 * 表达式里可以用 await（会按 awaitPromise 求值）。
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const opt = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  }),
);
const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const URL_ = positional[0] || 'http://127.0.0.1:8326/';
const JS = opt.js;
if (!JS || JS === true) { console.error('✗ 需要 --js="<表达式>"'); process.exit(1); }
const COOKIE = opt.cookie || null;
if (COOKIE !== null && COOKIE !== true && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  process.exit(1);
}
const WAIT = Number(opt.wait || 8000);
const PORT = 9700 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-eval-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1100', 'about:blank',
  ], { stdio: 'ignore' });

  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch { /* wait */ }
    await sleep(250);
  }
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });

  let id = 0; const pend = new Map(); const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    else if (m.method) events.push(m);
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (COOKIE && COOKIE !== true) {
    await send('Network.enable');
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  await send('Page.navigate', { url: URL_ });
  await sleep(WAIT);

  const r = await send('Runtime.evaluate', { expression: JS, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    console.error('✗ 表达式抛异常:', r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    process.exit(1);
  }
  console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown'
    || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  if (errs.length) {
    console.log('\n=== 控制台错误 ===');
    errs.slice(0, 6).forEach((e) => {
      const txt = e.params.exceptionDetails?.exception?.description
        || e.params.entry?.text
        || (e.params.args || []).map((a) => a.value || a.description || '').join(' ');
      console.log('  ·', String(txt).replace(/\n/g, ' ').slice(0, 240));
    });
  }

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
