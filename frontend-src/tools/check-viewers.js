const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL_ = 'http://127.0.0.1:8326/#/course-resources';
const TOKEN = 'L1Q8ITTnkF4CUIQI_q3RZ3e5VXbx1O3cqfgUDmhMuEU';
const OUT = 'D:/Program/Ai-Test/frontend-src/_shots-live/';
const PORT = 9566;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = [
  { name: '讲义PPT', re: '· 讲解$', root: '.pv-ppt' },
  { name: 'OBE大纲', re: '^第09讲：Raft共识算法原理与分布式领导者选举实现$', root: '.pv-doc' },
  { name: '试卷', re: '· 测验$', root: '.pv-paper' },
  { name: '源码', re: '· 编程练习$', root: '.pv-code' },
  { name: '视频', re: '· 课堂实录$', root: '.pv-video' },
  { name: '交互演示', re: '· 交互演示$', root: '.pv-iframe' },
];

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vw-'));
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
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };
  const shot = async (name) => { const d = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1600, height: 960, scale: 1.5 } }); fs.writeFileSync(OUT + name, Buffer.from(d.data, 'base64')); };

  await Promise.all([send('Page.enable'), send('Runtime.enable')]);
  const parts = ('pbl_session=' + TOKEN).split('=');
  await send('Network.setCookie', { name: parts[0], value: parts.slice(1).join('='), domain: '127.0.0.1', path: '/' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1.5, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);
  await evalJs("(function(){var g=document.getElementById('courseCardGrid');var c=Array.from(g.children).filter(function(x){return /CS-401/.test(x.textContent);})[0];c.click();})()");
  await sleep(900);

  const results = [];
  for (let i = 0; i < TYPES.length; i++) {
    const T = TYPES[i];
    const found = await evalJs("(function(){var cards=Array.from(document.querySelectorAll('#gridWrapper .card-title'));var re=new RegExp(" + JSON.stringify(T.re) + ");var t=cards.filter(function(e){return re.test(e.textContent.trim());})[0];if(t){t.click();return t.textContent.trim();}return null;})()");
    await sleep(700);
    const r = await evalJs("(function(){var root=document.querySelector(" + JSON.stringify(T.root) + ");return {found:!!root,visible:root?(root.getBoundingClientRect().height>0):false};})()");
    results.push({ 类型: T.name, 条目: found, 预览器存在: r.found, 可见: r.visible });
    await shot('viewer-' + i + '-' + T.name + '.png');
  }
  console.log(JSON.stringify(results, null, 1));
  console.log('控制台异常:', errs.length ? errs.slice(0, 4) : 0);
  ws.close(); proc.kill(); process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
