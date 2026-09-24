#!/usr/bin/env node
/**
 * 只做一件事：把「页面真实状态」原样倒出来。
 * 当 check-vault.js 的交互自检中途抛异常时，用它定位到底是哪一步没渲染出来。
 *
 * 用法：
 *   node tools/state-vault.js [url] [--cookie=pbl_session=xxx]
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
const URL_ = positional[0] || 'http://127.0.0.1:5600/_resource-vault.html';
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
const PORT = 9700 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-state-'));
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
  const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    else if (m.method) events.push(m);
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Network.enable'); // setCookie 之前必须先 enable，否则 Cookie 静默不生效
  if (COOKIE) {
    const [name, ...rest] = COOKIE.split('=');
    const setRes = await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    console.log('setCookie 返回:', JSON.stringify(setRes));
    const got = await send('Network.getCookies', { urls: [URL_] });
    console.log('Chrome 实际存的 cookie:', JSON.stringify(got.cookies.map((c) => ({ n: c.name, d: c.domain, p: c.path, v: c.value.slice(0, 12) + '…' }))));
  }
  await send('Page.navigate', { url: URL_ });
  await sleep(5000);

  const dc = await send('Runtime.evaluate', { returnByValue: true, expression: 'document.cookie' });
  console.log('页面里 document.cookie:', JSON.stringify(dc.result.value));

  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const q = (s) => document.querySelector(s);
      const $$ = (s) => [...document.querySelectorAll(s)];
      const txt = (s) => (q(s)?.textContent || '').trim().replace(/\\s+/g,' ').slice(0,80);
      return {
        readyState: document.readyState,
        hasScript: typeof window.__vaultLoaded,
        gridCards: $$('#gridWrapper [data-id]').length,
        gridHTMLlen: (q('#gridWrapper')?.innerHTML || '').length,
        tableRows: $$('#tableBody tr[data-id]').length,
        dataCheck: $$('[data-check]').length,
        dataPreview: $$('[data-preview]').length,
        iconifyTotal: $$('iconify-icon').length,
        iconifyRendered: $$('iconify-icon').filter(e => e.shadowRoot || e.querySelector('svg')).length,
        pills: $$('#categoryTabs [data-cat]').map(p => p.textContent.trim() + (p.classList.contains('is-on') ? '*' : '')),
        pillCounts: $$('#categoryTabs [data-cat]').length,
        resultCount: txt('#resultCountBadge'),
        statCourses: txt('#statCourses'),
        statTotalFiles: txt('#statTotalFiles'),
        navbarUser: txt('#navbarUser'),
        fatalShown: !(q('#emptyView')?.classList.contains('is-hidden') ?? true),
        emptyText: txt('#emptyView'),
        firstCardTitle: (q('#gridWrapper [data-id] .card-title')||{}).textContent,
      };
    })()`,
  });
  console.log('=== 页面状态 ===');
  console.log(JSON.stringify(r.result.value, null, 2));

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  console.log('\n=== 错误 ===');
  if (!errs.length) console.log('  (无)');
  errs.slice(0, 10).forEach((e) => {
    const d = e.params.exceptionDetails || e.params.entry;
    console.log('  ' + (d.exception?.description || d.text || JSON.stringify(d)).slice(0, 400));
  });

  // 接口调用：cookie 到底有没有带上、后端回了什么。
  // 注意：不要看 Network.requestWillBeSent 的 headers —— Chrome 会把 Cookie 头抹掉，
  // 于是永远显示「无 cookie」，是个假阴性。真实发送的头在 requestWillBeSentExtraInfo 里。
  const reqs = new Map();
  events.filter((e) => e.method === 'Network.requestWillBeSent').forEach((e) => reqs.set(e.params.requestId, e.params.request));
  const extra = new Map();
  events.filter((e) => e.method === 'Network.requestWillBeSentExtraInfo').forEach((e) => extra.set(e.params.requestId, e.params.headers));
  const resps = events.filter((e) => e.method === 'Network.responseReceived' && /\/api\//.test(e.params.response.url));
  console.log('\n=== 接口调用 ===');
  if (!resps.length) console.log('  (页面没有发出任何 /api/ 请求)');
  resps.forEach((e) => {
    const h = extra.get(e.params.requestId) || {};
    const ck = h.Cookie || h.cookie || '';
    const cookieSent = ck.includes('pbl_session') ? '带 cookie' : '未带 cookie';
    console.log(`  ${e.params.response.status}  ${e.params.response.url.replace(/^http:\/\/127\.0\.0\.1:5600/, '')}  [${cookieSent}]`);
  });

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
