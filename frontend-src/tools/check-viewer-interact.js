const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://127.0.0.1:8326/#/course-resources';
const TOKEN = 'L1Q8ITTnkF4CUIQI_q3RZ3e5VXbx1O3cqfgUDmhMuEU';
const PORT = 9577;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-'));
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
  const parts = ('pbl_session=' + TOKEN).split('=');
  await send('Network.setCookie', { name: parts[0], value: parts.slice(1).join('='), domain: '127.0.0.1', path: '/' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);
  await ev("(function(){var g=document.getElementById('courseCardGrid');var c=Array.from(g.children).filter(function(x){return /CS-401/.test(x.textContent);})[0];c.click();})()");
  await sleep(900);

  async function openByRe(re) {
    return await ev("(function(){var cards=Array.from(document.querySelectorAll('#gridWrapper .card-title'));var r=new RegExp(" + JSON.stringify(re) + ");var t=cards.filter(function(e){return r.test(e.textContent.trim());})[0];if(t){t.click();return t.textContent.trim();}return null;})()");
  }
  const out = {};

  // ① PPT 翻页
  await openByRe('· 讲解$'); await sleep(600);
  const s0 = await ev("document.getElementById('pvSlide').querySelector('h3').textContent");
  await ev("document.getElementById('pvNext').click()"); await sleep(300);
  const s1 = await ev("document.getElementById('pvSlide').querySelector('h3').textContent");
  const thumb = await ev("document.querySelectorAll('#pvThumbs .pv-thumb').length");
  out['① 讲义PPT'] = { 首页: s0, 点下一页后: s1, 缩略图数: thumb, 翻页生效: s0 !== s1 };

  // ② OBE 大纲：内容 + 缩放 + 双视图
  await openByRe('^第09讲：Raft共识算法原理与分布式领导者选举实现$'); await sleep(600);
  const docInfo = await ev("(function(){return {表格数:document.querySelectorAll('#pvA4 table').length, 导航项:document.querySelectorAll('.pv-toc a').length, 考核条:document.querySelectorAll('#pvA4 .pv-bar').length, 进度行:document.querySelectorAll('#pvA4 tbody tr').length, 红头:!!document.querySelector('.pv-a4-head .pv-red'), 签名:!!document.querySelector('.pv-a4 .pv-sign')};})()");
  await ev("document.getElementById('pvZoomIn').click();document.getElementById('pvZoomIn').click()"); await sleep(200);
  const zoom = await ev("document.getElementById('pvZoomVal').textContent");
  await ev("document.querySelector('#pvDocSeg button[data-v=\"memo\"]').click()"); await sleep(300);
  const memo = await ev("(function(){var m=document.getElementById('pvMemo');return {存在:!!m, 可见:m?getComputedStyle(m).display!=='none':false, 条数:m?m.querySelectorAll('li').length:0};})()");
  out['② OBE大纲'] = Object.assign(docInfo, { 缩放后: zoom, 备忘录: memo });

  // ③ 试卷：答案切换
  await openByRe('· 测验$'); await sleep(600);
  const q0 = await ev("document.querySelectorAll('#pvQList .pv-q').length");
  const a0 = await ev("document.querySelectorAll('#pvQList .pv-exp').length");
  await ev("document.querySelector('#pvPaperSeg button[data-v=\"answer\"]').click()"); await sleep(300);
  const a1 = await ev("document.querySelectorAll('#pvQList .pv-exp').length");
  const rub = await ev("document.querySelectorAll('#pvQList .pv-rubric').length");
  out['③ 试卷'] = { 题数: q0, 卷面态答案块: a0, 切答案后答案块: a1, 评分细则数: rub };

  // ④ 源码：文件切换
  await openByRe('· 编程练习$'); await sleep(600);
  const f0 = await ev("document.getElementById('pvFileName').textContent");
  const tabs = await ev("document.querySelectorAll('#pvTree button').length");
  const lines = await ev("document.querySelectorAll('#pvLines br').length");
  await ev("document.querySelectorAll('#pvTree button')[1].click()"); await sleep(300);
  const f1 = await ev("document.getElementById('pvFileName').textContent");
  const cons = await ev("document.querySelectorAll('#pvConsole div').length");
  out['④ 源码'] = { 初始文件: f0, 文件数: tabs, 行号数: lines, 切换后: f1, 切换生效: f0 !== f1, 控制台行: cons };

  // ⑤ 视频：章节跳转
  await openByRe('· 课堂实录$'); await sleep(600);
  const c0 = await ev("document.getElementById('pvNow').textContent");
  await ev("document.querySelectorAll('#pvChapters button')[2].click()"); await sleep(300);
  const c1 = await ev("document.getElementById('pvNow').textContent");
  const chN = await ev("document.querySelectorAll('#pvChapters button').length");
  const trN = await ev("document.querySelectorAll('#pvTranscript .pv-ts').length");
  out['⑤ 视频'] = { 章节数: chN, 字幕条数: trN, 起始时间: c0, 跳转后: c1, 跳转生效: c0 !== c1 };

  console.log(JSON.stringify(out, null, 1));
  console.log('控制台异常:', errs.length ? errs.slice(0, 4) : 0);
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
