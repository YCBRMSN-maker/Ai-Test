#!/usr/bin/env node
/**
 * 课程资源管理页 多状态截图（CDP）
 * 一次性截出：整页 / 清单视图 / 预览弹窗 / 上传弹窗 / 空状态 / 批量选择
 *
 * 用法：node tools/shots-vault.js <url> <outDir>
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

const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const URL_ = positional[0] || 'http://127.0.0.1:5600/_resource-vault.html';
const OUT = positional[1] || 'D:/Program/Ai-Test/frontend-src/_shots';
const COOKIE = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--cookie='));
  return a ? a.replace('--cookie=', '') : null;
})();
// 见 check-vault.js 同名守卫：--cookie 为空时直接退出，避免把「未登录」误报成页面 bug。
if (COOKIE !== null && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  console.error('  请把 TOKEN 的赋值单独写成一行，不要和 node 命令挤在同一个简单命令里。');
  process.exit(1);
}
const PORT = 9333 + (process.pid % 200);
const W = 1600;
const H = 1100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('Chrome/Edge not found');
}

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('devtools endpoint never became ready');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 30000);
    });
  }
}

(async () => {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-vshots-'));
  fs.mkdirSync(OUT, { recursive: true });

  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`, 'about:blank',
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

    // 页面数据全部来自真实接口，必须带上登录态
    if (COOKIE) {
      const [name, ...rest] = COOKIE.split('=');
      await cdp.send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    }

    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(5000);

    const evalJs = (expr) => cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });

    const shoot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(OUT, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      const kb = (fs.statSync(file).size / 1024).toFixed(0);
      console.log(`saved ${file} (${kb} KB)`);
    };

    // 1. 整页默认态
    await shoot('vault-1-overview');

    // 2. 清单视图
    await evalJs(`document.querySelector('#viewSeg [data-view="list"]').click()`);
    await sleep(600);
    await shoot('vault-2-list');
    await evalJs(`document.querySelector('#viewSeg [data-view="grid"]').click()`);
    await sleep(400);

    // 3. 筛选 + 批量选择（同时展示批量操作栏）
    await evalJs(`(() => {
      const pill = document.querySelector('#categoryTabs [data-cat="quiz"]')
                || document.querySelector('#categoryTabs [data-cat]');
      if (pill) pill.click();
      const cbs = [...document.querySelectorAll('[data-check]')];
      cbs.slice(0, 3).forEach(c => c.click());
      return { picked: pill && pill.dataset.cat, checked: document.querySelectorAll('[data-check]:checked').length };
    })()`);
    await sleep(800);
    await shoot('vault-3-filter-batch');

    // 4. 预览弹窗
    await evalJs(`document.querySelector('#resetBtn').click()`);
    await sleep(400);
    await evalJs(`document.querySelector('[data-preview]').click()`);
    await sleep(700);
    await shoot('vault-4-preview');

    // 5. 上传弹窗
    await evalJs(`document.querySelector('#previewClose').click()`);
    await sleep(500);
    await evalJs(`document.querySelector('#openUploadBtn').click()`);
    await sleep(700);
    await shoot('vault-5-upload');

    // 6. 空状态
    await evalJs(`document.querySelector('#uploadClose').click()`);
    await sleep(400);
    await evalJs(`(() => {
      const gs = document.querySelector('#globalSearch');
      gs.value = '不存在的资料XYZ';
      gs.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await sleep(700);
    await shoot('vault-6-empty');
  } catch (err) {
    console.error('FATAL:', err.message);
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
