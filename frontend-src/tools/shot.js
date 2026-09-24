#!/usr/bin/env node
/**
 * 教师端 UI 截图工具（CDP）
 *
 * 用途：无头 Chrome + DevTools Protocol，先注入会话 Cookie 再导航，
 *      从而截到需要登录的教师端页面。纯 Node 实现，无第三方依赖。
 *
 * 用法：
 *   node shot.js <url> <out.png> [--wait=3000] [--cookie=name=value] [--w=1600] [--h=1000]
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const opt = Object.fromEntries(
  args.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);

if (!url || !out) {
  console.error('usage: node shot.js <url> <out.png> [--wait=3000] [--cookie=n=v] [--w=1600] [--h=1000]');
  process.exit(1);
}

const WAIT = Number(opt.wait || 3500);
const W = Number(opt.w || 1600);
const H = Number(opt.h || 1000);
const PORT = 9333 + (process.pid % 200);
const COOKIE = opt.cookie ? String(opt.cookie) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('Chrome/Edge not found');
}

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('devtools endpoint never became ready');
}

/** 极简 CDP 客户端 */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
}

(async () => {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-shot-'));

  const proc = spawn(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  let ws;
  try {
    await waitForDevtools();

    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: 1, mobile: false,
    });

    if (COOKIE) {
      const [name, ...rest] = COOKIE.split('=');
      await cdp.send('Network.setCookie', {
        name,
        value: rest.join('='),
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      });
    }

    await cdp.send('Page.navigate', { url });
    await sleep(WAIT);

    // 输出实际落地 URL 与页面标题，便于排查路由重定向
    try {
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({url: location.href, title: document.title, app: !!document.querySelector("#app > *")})',
        returnByValue: true,
      });
      console.log('landed:', result.value);
    } catch { /* ignore */ }

    // --js=<expr> 时只求值并打印，不截图（用于探查 DOM / 计算样式）
    if (opt.js) {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression: String(opt.js),
        returnByValue: true,
        awaitPromise: true,
      });
      console.log('eval:', exceptionDetails ? JSON.stringify(exceptionDetails) : JSON.stringify(result.value, null, 2));
      return;
    }

    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    console.log(`saved ${out} (${fs.statSync(out).size} bytes)`);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
