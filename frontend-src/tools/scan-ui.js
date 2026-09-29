#!/usr/bin/env node
/**
 * UI 几何自检：不用肉眼看，直接量。
 *   ① 纯图标容器里图标是否居中（中心偏移 ≤1px 且不外溢）
 *   ② 元素是否横向超出父容器
 *   ③ 单行文字是否被截断（ellipsis/hidden 且 scrollWidth 明显超 clientWidth）
 *
 * 依次扫多个界面：课程列表 → 资料网格 → 表格清单 → 导出弹窗(JSON/原始文件) → 上传弹窗 → 六类预览器。
 * 用法： node tools/scan-ui.js [url] [--cookie=pbl_session=xxx]
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.join('=') || true];
}));
const positional = process.argv.slice(2).filter((x) => !x.startsWith('--'));
const URL_ = positional[0] || 'http://127.0.0.1:8326/#/course-resources';
const COOKIE = opt.cookie || null;
const PORT = 9930 + (process.pid % 50);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 扫描表达式：在每个界面上跑一遍
const SCAN = `(function(){
  var out = { 图标未居中: [], 元素外溢: [], 文字被截: [] };
  var root = document.querySelector('.cr-host') || document.body;
  root.querySelectorAll('*').forEach(function (box) {
    if (box.tagName === 'ICONIFY-ICON') return;
    if ((box.textContent || '').trim()) return;   // 只查纯图标容器：图标+文字的横排本就该左对齐
    var ico = box.querySelector(':scope > iconify-icon');
    if (!ico) return;
    var b = box.getBoundingClientRect(); if (b.width < 8 || b.height < 8) return;
    var i = ico.getBoundingClientRect(); if (i.width === 0) return;
    var dx = Math.round((i.left + i.width / 2) - (b.left + b.width / 2));
    var dy = Math.round((i.top + i.height / 2) - (b.top + b.height / 2));
    var ovf = (i.left < b.left - 1 || i.right > b.right + 1 || i.top < b.top - 1 || i.bottom > b.bottom + 1);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || ovf) out.图标未居中.push({ el: box.className || box.tagName, box: Math.round(b.width)+'x'+Math.round(b.height), dx: dx, dy: dy, 外溢: ovf });
  });
  root.querySelectorAll('*').forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') return;
    if (cs.overflow !== 'visible' || !el.parentElement) return;
    var p = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
    if (r.width === 0) return;
    var over = Math.round(Math.max(r.right - p.right, p.left - r.left));
    if (over > 3) out.元素外溢.push({ el: el.className || el.tagName, 超出: over, w: Math.round(r.width), pw: Math.round(p.width) });
  });
  root.querySelectorAll('span, b, h3, h4, p, a, label, td, th').forEach(function (el) {
    var cs = getComputedStyle(el);
    if (cs.whiteSpace === 'normal') return;
    if (cs.textOverflow !== 'ellipsis' && cs.overflow !== 'hidden') return;
    if (el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 2) out.文字被截.push({ el: el.className || el.tagName, text: (el.textContent||'').slice(0, 24), scrollW: el.scrollWidth, clientW: el.clientWidth });
  });
  // 已知的有意行为，不算问题：课程代码过长时截断（完整值在 title 里）
  var EXPECTED_CLIP = ['course-card-code'];
  out.文字被截 = out.文字被截.filter(function (x) { return EXPECTED_CLIP.indexOf(String(x.el).split(' ')[0]) < 0; });
  ['图标未居中','元素外溢','文字被截'].forEach(function(k){
    var seen={}, arr=[]; out[k].forEach(function(x){var key=JSON.stringify(x); if(!seen[key]){seen[key]=1;arr.push(x);}});
    out[k]=arr.slice(0,8);
  });
  return out;})()`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-'));
  const proc = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/json/version'); if (r.ok) break; } catch (e) { /* wait */ } await sleep(250); }
  const t = await (await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let id = 0; const pend = new Map(); const errs = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') { errs.push(m.params.exceptionDetails.exception?.description || 'err'); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };

  await Promise.all([send('Page.enable'), send('Runtime.enable')]);
  const token = (COOKIE && COOKIE !== true) ? COOKIE.split('=').slice(1).join('=') : '';
  if (!token) { console.error('FATAL: 缺少 --cookie=pbl_session=xxx'); process.exit(1); }
  await send('Network.setCookie', { name: 'pbl_session', value: token, domain: '127.0.0.1', path: '/' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  const openItem = (re) => ev("(function(){var cards=Array.from(document.querySelectorAll('#gridWrapper .card-title'));var r=new RegExp(" + JSON.stringify(re) + ");var t=cards.filter(function(e){return r.test(e.textContent.trim());})[0];if(t){t.click();return t.textContent.trim();}return null;})()");
  const closePreview = () => ev("(function(){var b=document.getElementById('previewClose');if(b&&!document.getElementById('previewModal').classList.contains('is-hidden'))b.click();})()");

  const SURFACES = [
    { name: '课程列表（默认态）', setup: null },
    { name: '课程内资料网格', setup: async () => { await ev("(function(){var g=document.getElementById('courseCardGrid');var c=Array.from(g.children).filter(function(x){return /CS-401/.test(x.textContent);})[0];c.click();})()"); await sleep(800); } },
    { name: '表格清单视图', setup: async () => { await ev("document.querySelector('#viewSeg button[data-view=\"list\"]').click()"); await sleep(500); } },
    { name: '导出弹窗（JSON）', setup: async () => { await ev("document.querySelector('#viewSeg button[data-view=\"grid\"]').click()"); await sleep(300); await ev("document.getElementById('exportDataBtn').click()"); await sleep(800); }, teardown: async () => { await ev("document.getElementById('exportClose').click()"); await sleep(400); } },
    { name: '导出弹窗（原始文件）', setup: async () => { await ev("document.getElementById('exportDataBtn').click()"); await sleep(600); await ev("document.querySelector('#exportFormatSeg button[data-fmt=\"files\"]').click()"); await sleep(500); }, teardown: async () => { await ev("document.getElementById('exportClose').click()"); await sleep(400); } },
    { name: '上传弹窗', setup: async () => { await ev("document.getElementById('openUploadBtn').click()"); await sleep(700); }, teardown: async () => { await ev("document.getElementById('uploadClose').click()"); await sleep(400); } },
  ];
  const VIEWERS = [
    { name: '预览·讲义PPT', re: '· 讲解$' },
    { name: '预览·OBE大纲', re: '^第09讲：Raft共识算法原理与分布式领导者选举实现$' },
    { name: '预览·试卷', re: '· 测验$' },
    { name: '预览·源码', re: '· 编程练习$' },
    { name: '预览·视频', re: '· 课堂实录$' },
    { name: '预览·交互演示', re: '· 交互演示$' },
  ];
  for (const v of VIEWERS) {
    SURFACES.push({
      name: v.name,
      setup: async () => { await openItem(v.re); await sleep(900); },
      teardown: async () => { await closePreview(); await sleep(350); },
    });
  }

  let total = 0;
  for (const s of SURFACES) {
    if (s.setup) await s.setup();
    const rep = await ev(SCAN);
    const n = rep.图标未居中.length + rep.元素外溢.length + rep.文字被截.length;
    total += n;
    console.log(`\n── ${s.name} ── ${n === 0 ? '✓ 无问题' : n + ' 处'}`);
    ['图标未居中', '元素外溢', '文字被截'].forEach((k) => {
      if (!rep[k].length) return;
      console.log('   ' + k + ':');
      rep[k].forEach((x) => console.log('     ·', JSON.stringify(x)));
    });
    if (s.teardown) await s.teardown();
  }

  console.log('\n══════════════════════════════════════════');
  console.log(total === 0 ? ' 结论：全部界面几何自检通过 ✓' : ` 结论：共 ${total} 处待看（逐条判断是否真问题）`);
  console.log('控制台异常:', errs.length ? errs.slice(0, 3) : 0);
  console.log('══════════════════════════════════════════');
  try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
  process.exit(total === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
