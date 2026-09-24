#!/usr/bin/env node
/**
 * 「课程资源管理页并入 teacher-dist 之后」的多状态截图。
 *
 * 和 shots-vault.js 的区别：那个拍的是独立预览页（自带复刻外壳），
 * 这个拍的是**真实应用**里的效果 —— 真侧栏、真顶栏、真路由。
 *
 * 用法：
 *   node tools/shots-integrated.js [url] <outDir> [--cookie=pbl_session=xxx]
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

const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const URL_ = positional[0] || 'http://127.0.0.1:5601/';
const OUT = positional[1] || 'D:/Program/Ai-Test/frontend-src/_shots-integrated';
const COOKIE = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--cookie='));
  return a ? a.replace('--cookie=', '') : null;
})();
if (COOKIE !== null && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  console.error('  请把 TOKEN 的赋值单独写成一行，不要和 node 命令挤在同一个简单命令里。');
  process.exit(1);
}
const PORT = 9600 + (process.pid % 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shotint-'));
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

  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (COOKIE) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(OUT, name + '.png');
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    console.log('saved ' + p + '  (' + Math.round(fs.statSync(p).size / 1024) + ' KB)');
  };

  // 1. 直接落在新页面（真实应用外壳 + 真实数据）
  await send('Page.navigate', { url: URL_ + '#/course-resources' });
  await sleep(9000);
  await shot('int-1-page');

  // 2. 卡片视图 + 分类筛选
  await evalJs(`(async () => {
    const pill = [...document.querySelectorAll('.cr-host #categoryTabs [data-cat]')]
      .find(p => p.dataset.cat === 'quiz');
    if (pill) pill.click();
    await new Promise(r => setTimeout(r, 700));
  })()`);
  await shot('int-2-filter');

  // 3. 清单视图
  await evalJs(`(async () => {
    document.querySelector('.cr-host #resetBtn').click();
    const list = [...document.querySelectorAll('.cr-host #viewSeg button')].find(b => b.dataset.view === 'list');
    if (list) list.click();
    await new Promise(r => setTimeout(r, 700));
  })()`);
  await shot('int-3-list');

  // 4. 详情预览弹窗
  await evalJs(`(async () => {
    const grid = [...document.querySelectorAll('.cr-host #viewSeg button')].find(b => b.dataset.view === 'grid');
    if (grid) grid.click();
    await new Promise(r => setTimeout(r, 400));
    const pv = document.querySelector('.cr-host [data-preview]');
    if (pv) pv.click();
    await new Promise(r => setTimeout(r, 800));
  })()`);
  await shot('int-4-preview');

  // 5. 批量选择（浮层挂在 body 上，要确认在真实外壳里定位正确）
  // 注意：#previewClose / #dockClear / #uploadClose 都在 body 下的浮层里，
  // 不在 .cr-host 内，用 .cr-host 前缀会查不到。
  await evalJs(`(async () => {
    document.querySelector('#previewClose').click();
    await new Promise(r => setTimeout(r, 500));
    const cb = document.querySelector('.cr-host [data-check]');
    if (cb) cb.click();
    await new Promise(r => setTimeout(r, 800));
  })()`);
  await shot('int-5-dock');

  // 6. 存入资料弹窗
  await evalJs(`(async () => {
    document.querySelector('#dockClear').click();
    await new Promise(r => setTimeout(r, 400));
    document.querySelector('.cr-host #openUploadBtn').click();
    await new Promise(r => setTimeout(r, 800));
  })()`);
  await shot('int-6-upload');

  // 7. 首页（确认原有页面没被影响）
  await evalJs(`(async () => {
    document.querySelector('#uploadClose').click();
    await new Promise(r => setTimeout(r, 300));
    const home = [...document.querySelectorAll('.layout__sidebar a[href]')].find(a => /#\\/dashboard/.test(a.getAttribute('href') || ''));
    if (home) home.click();
    await new Promise(r => setTimeout(r, 2500));
  })()`);
  await shot('int-7-dashboard');

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
