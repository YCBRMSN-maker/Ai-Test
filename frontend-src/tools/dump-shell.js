#!/usr/bin/env node
/**
 * 抓真实教师端（8326）的外壳结构：侧边栏 + 顶栏。
 * 目的：新页面要贴着真实外壳做，不能自己脑补配额条、用户名之类的元素。
 *
 * 用法：node tools/dump-shell.js [--cookie=pbl_session=xxx]
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

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || true];
}));

const URL_ = opt.url || 'http://127.0.0.1:8326/';
const PORT = 9333 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shell-'));
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
  const send = (method, params = {}) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => {
      pend.set(i, { resolve, reject });
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 30000);
    });
  };

  try {
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    if (opt.cookie) {
      const [name, ...rest] = String(opt.cookie).split('=');
      await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    }
    await send('Page.navigate', { url: URL_ });
    await sleep(4500);

    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };

        // 侧边栏：取最靠左的、高度接近整屏的容器
        const cands = [...document.querySelectorAll('aside, .sidebar, .el-aside, [class*=sidebar], [class*=aside]')].filter(vis);
        cands.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
        const side = cands[0] || null;

        // 顶栏：取靠顶部、横向铺开的 header
        const heads = [...document.querySelectorAll('header, .navbar, .topbar, [class*=navbar], [class*=header]')].filter(vis);
        heads.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const head = heads[0] || null;

        const dump = (el) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            cls: el.className,
            size: Math.round(b.width) + 'x' + Math.round(b.height),
            text: clean(el.textContent).slice(0, 300),
            imgCount: el.querySelectorAll('img, .avatar, [class*=avatar]').length,
            children: [...el.children].map((c) => ({
              tag: c.tagName.toLowerCase(),
              cls: String(c.className).slice(0, 90),
              text: clean(c.textContent).slice(0, 120),
            })),
          };
        };

        // 菜单项文本
        const menuTexts = side ? [...side.querySelectorAll('a, li, [class*=menu-item], [class*=el-menu-item]')]
          .map((e) => clean(e.textContent)).filter(Boolean).slice(0, 30) : [];

        return { url: location.href, sidebar: dump(side), topbar: dump(head), menuTexts };
      })()`, returnByValue: true, awaitPromise: true,
    });
    console.log(JSON.stringify(r.result.value, null, 2));
  } catch (e) {
    console.error('FATAL:', e.message);
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
