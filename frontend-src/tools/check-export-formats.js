#!/usr/bin/env node
/**
 * 「按真实类型导出」验证：
 *   A. 预览弹窗尺寸固定 92vh（不再随内容忽高忽低）
 *   B. 导出菜单按条目类型给格式（文档→doc、课件→ppt、源码→zip、上传件→原文件…）
 *   C. 真的落盘：文件名扩展名与格式一致，且内容非空
 *
 * 用法： node tools/check-export-formats.js <url> --cookie=pbl_session=xxx
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
const PORT = 9700 + (process.pid % 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════'); };

const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'exf-'));
// Chrome 会在下载目录里留下自己的 downloads.htm，别把它当成我们导出的文件
const IGNORE = new Set(['downloads.htm']);
const listFresh = (before) => fs.readdirSync(DL)
  .filter((x) => !x.endsWith('.crdownload') && !IGNORE.has(x) && !before.has(x));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ef-'));
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
    else if (m.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };

  await Promise.all([send('Page.enable'), send('Runtime.enable')]);
  const token = (COOKIE && COOKIE !== true) ? COOKIE.split('=').slice(1).join('=') : '';
  if (!token) { console.error('FATAL: 缺少 --cookie=pbl_session=xxx'); process.exit(1); }
  await send('Network.setCookie', { name: 'pbl_session', value: token, domain: '127.0.0.1', path: '/' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);
  await ev("(function(){var g=document.getElementById('courseCardGrid');var c=Array.from(g.children).filter(function(x){return /CS-401/.test(x.textContent);})[0];c.click();})()");
  await sleep(900);

  async function openByRe(re) {
    return await ev("(function(){var cards=Array.from(document.querySelectorAll('#gridWrapper .card-title'));var r=new RegExp(" + JSON.stringify(re) + ");var t=cards.filter(function(e){return r.test(e.textContent.trim());})[0];if(t){t.click();return t.textContent.trim();}return null;})()");
  }
  async function menuItems() {
    await ev("document.getElementById('previewDownload').click()");
    await sleep(350);
    const items = await ev("Array.from(document.querySelectorAll('#previewExportMenu button[data-fmt]')).map(function(b){return {fmt:b.dataset.fmt,text:b.textContent.trim()};})");
    return items;
  }
  async function closeMenu() { await ev("document.getElementById('previewExportMenu').classList.add('is-hidden')"); }

  // ---------- A. 弹窗尺寸 ----------
  head('A. 预览弹窗尺寸（固定 92vh）');
  await openByRe('· 编程练习$'); await sleep(700);
  const box1 = await ev("(function(){var m=document.querySelector('#previewModal .modal');var r=m.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})()");
  await ev("document.getElementById('previewClose').click()"); await sleep(300);
  await openByRe('^第09讲：Raft共识算法原理与分布式领导者选举实现$'); await sleep(700);
  const box2 = await ev("(function(){var m=document.querySelector('#previewModal .modal');var r=m.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)};})()");
  if (box1.h === box2.h && box1.h > 800) ok(`代码条目与大纲条目弹窗高度一致（${box1.h}px = ${box2.h}px，视口 1000 → 92vh）`);
  else bad(`弹窗高度仍随内容变化：${box1.h} vs ${box2.h}`);
  if (box1.w === 1152 || Math.abs(box1.w - 1152) < 20) ok(`弹窗宽度 ${box1.w}px（对齐 max-w-6xl / 1152px）`);
  else bad(`弹窗宽度 ${box1.w}px，与 1152 差距较大`);

  // ---------- B. 导出菜单按类型 ----------
  head('B. 导出菜单按条目类型给格式');
  const expect = [
    { re: '^第09讲：Raft共识算法原理与分布式领导者选举实现$', want: ['doc', 'pdf'], name: '教学大纲' },
    { re: '· 讲解$', want: ['ppt', 'pdf'], name: '讲义 PPT' },
    { re: '· 测验$', want: ['doc', 'pdf'], name: '试卷' },
    { re: '· 编程练习$', want: ['zip'], name: '实验源码' },
  ];
  for (const e of expect) {
    await ev("document.getElementById('previewClose').click()"); await sleep(250);
    await openByRe(e.re); await sleep(600);
    const items = await menuItems();
    const fmts = items.map((x) => x.fmt).sort().join(',');
    if (fmts === e.want.slice().sort().join(',')) ok(`${e.name} → ${items.map((x) => '.' + x.text.split('.').pop()).join(' / ')}`);
    else bad(`${e.name} 菜单不符：得到 [${fmts}]，期望 [${e.want.join(',')}]`);
    await closeMenu();
  }

  // ---------- C. 真的落盘 ----------
  head('C. 导出真的落盘（扩展名与格式一致）');
  async function exportAndCheck(re, fmt, extWanted) {
    await ev("document.getElementById('previewClose').click()"); await sleep(300);
    const title = await openByRe(re); await sleep(700);
    await ev("document.getElementById('previewDownload').click()"); await sleep(350);
    const avail = await ev("Array.from(document.querySelectorAll('#previewExportMenu button[data-fmt]')).map(function(b){return b.dataset.fmt;})");
    if (avail.indexOf(fmt) < 0) return { ok: false, msg: '菜单里没有 ' + fmt + '（实际 [' + avail.join(',') + ']；打开的是「' + title + '」）' };
    // 注意：不能只看「数量变多」，也不能取 readdir 的最后一个 —— 它是按名字排序的，
    // 可能一直命中上一轮那份文件。要对比前后集合，找出**新增**的那个。
    const beforeSet = new Set(fs.readdirSync(DL));
    await ev("(function(){var b=document.querySelector('#previewExportMenu button[data-fmt=\"" + fmt + "\"]');if(b)b.click();})()");
    let file = null;
    for (let i = 0; i < 24; i++) {
      await sleep(350);
      const fresh = listFresh(beforeSet);
      if (fresh.length) { file = fresh[0]; break; }
    }
    if (!file) return { ok: false, msg: '未落盘' };
    const size = fs.statSync(path.join(DL, file)).size;
    const okExt = file.toLowerCase().endsWith('.' + extWanted);
    return { ok: okExt && size > 100, msg: `${file}（${size} 字节）`, file, size };
  }
  const r1 = await exportAndCheck('^第09讲：Raft共识算法原理与分布式领导者选举实现$', 'doc', 'doc');
  if (r1.ok) ok('教学大纲 → ' + r1.msg); else bad('教学大纲导出失败：' + r1.msg);
  const r2 = await exportAndCheck('· 讲解$', 'ppt', 'ppt');
  if (r2.ok) ok('讲义 PPT → ' + r2.msg); else bad('讲义 PPT 导出失败：' + r2.msg);
  const r3 = await exportAndCheck('· 编程练习$', 'zip', 'zip');
  if (r3.ok) ok('实验源码 → ' + r3.msg); else bad('源码导出失败：' + r3.msg);
  // ZIP 结构粗校验：PK\x03\x04 开头
  if (r3.file) {
    const b = fs.readFileSync(path.join(DL, r3.file));
    if (b[0] === 0x50 && b[1] === 0x4b) ok('ZIP 文件头正确（PK\\x03\\x04）');
    else bad('ZIP 文件头不对：' + b.slice(0, 4).toString('hex'));
  }
  // Word 内容粗校验：含 OOXML 命名空间与标题
  if (r1.file) {
    const s = fs.readFileSync(path.join(DL, r1.file), 'utf8');
    if (/schemas-microsoft-com:office:word/.test(s) && /Raft/.test(s)) ok('Word 文件含 Office 命名空间与标题');
    else bad('Word 文件内容不符预期');
  }

  // ---------- E. 浮动舱「打包下载 (.ZIP)」 ----------
  head('E. 浮动舱「打包下载 (.ZIP)」');
  await ev("document.getElementById('previewClose').click()"); await sleep(300);
  const pickedN = await ev("(function(){var cbs=Array.from(document.querySelectorAll('#gridWrapper [data-check]'));var n=0;for(var i=0;i<cbs.length && n<4;i++){cbs[i].click();n++;}return n;})()");
  await sleep(450);
  const dockCount = await ev("document.getElementById('dockSelectedCount').textContent");
  const beforeSet2 = new Set(fs.readdirSync(DL));
  await ev("document.getElementById('dockPack').click()");
  let zipFile = null;
  for (let i = 0; i < 24; i++) {
    await sleep(350);
    const fresh = listFresh(beforeSet2).filter((x) => x.toLowerCase().endsWith('.zip'));
    if (fresh.length) { zipFile = fresh[0]; break; }
  }
  if (zipFile && zipFile.toLowerCase().endsWith('.zip')) {
    const b = fs.readFileSync(path.join(DL, zipFile));
    const isZip = b[0] === 0x50 && b[1] === 0x4b;
    const hasEntry = ['.doc', '.ppt', '.json', '.md', '.txt'].some((ext) => b.includes(Buffer.from(ext)));
    if (isZip && hasEntry) ok(`打包下载 → ${zipFile}（${b.length} 字节，含条目文件；勾选 ${pickedN} 条 / 舱内计数 ${dockCount}）`);
    else bad(`ZIP 结构异常：zip=${isZip} 含条目文件=${hasEntry}`);
  } else bad('打包下载未落盘：' + zipFile);
  await ev("document.getElementById('dockClear').click()"); await sleep(300);

  // ---------- D. 控制台 ----------
  head('D. 控制台');
  if (!errs.length) ok('0 错误');
  else { bad(`${errs.length} 条错误`); errs.slice(0, 4).forEach((e) => console.log('   ·', String(e).replace(/\n/g, ' ').slice(0, 180))); }

  console.log('\n══════════════════════════════════════════');
  console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
  console.log('══════════════════════════════════════════');
  try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
  try { fs.rmSync(DL, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  process.exit(code);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
