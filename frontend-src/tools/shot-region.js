#!/usr/bin/env node
/**
 * 截取页面指定区域（默认侧栏），放大看清楚细节。
 * 用 Page.captureScreenshot 的 clip + scale，比整屏截图再放大清楚得多。
 *
 * 用法：
 *   node tools/shot-region.js <url> <out.png> [--clip=x,y,w,h] [--scale=2] [--cookie=...]
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
const OUT = positional[1] || 'D:/Program/Ai-Test/frontend-src/_shots-region/region.png';
const COOKIE = opt.cookie || null;
if (COOKIE !== null && COOKIE !== true && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  process.exit(1);
}
const CLIP = (opt.clip && opt.clip !== true) ? opt.clip.split(',').map(Number) : null;
const SCALE = Number(opt.scale || 2);
const PORT = 9500 + (process.pid % 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-region-'));
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

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (COOKIE && COOKIE !== true) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  // 没指定 clip 就自动取侧栏
  let clip = CLIP;
  if (!clip) {
    const r = await send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const sb = document.querySelector('.layout__sidebar');
        if (!sb) return null;
        const b = sb.getBoundingClientRect();
        return [b.x, b.y, b.width, b.height];
      })()`,
    });
    if (r.result.value) clip = r.result.value;
  }
  if (!clip) { console.error('✗ 拿不到裁剪区域'); process.exit(1); }

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: SCALE },
  });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`saved ${OUT}  clip=${clip.join(',')} scale=${SCALE}  (${Math.round(fs.statSync(OUT).size / 1024)} KB)`);

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
