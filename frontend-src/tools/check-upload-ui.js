#!/usr/bin/env node
/**
 * 端到端验证「存入历史资料」：上传任意文件 + 真实按钮下载/删除。
 *
 * 与 check-upload.js 的区别：下载与删除都通过**界面真实按钮**触发
 * （data-download / data-delete），而不是在页面里直接 fetch，
 * 用来确认我新加的事件处理真的接上了。
 *
 * 用法： node tools/check-upload-ui.js <url> --cookie=pbl_session=xxx
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
const URL_ = positional[0] || 'http://127.0.0.1:8326/#/course-resources';
const COOKIE = opt.cookie || null;
if (COOKIE !== null && COOKIE !== true && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  process.exit(1);
}
const PORT = 9400 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════════════════'); };

// 造一个「任意格式」的二进制测试文件（带中文名，含随机字节，证明不限格式）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
const UPLOAD_PATH = path.join(tmpDir, '测试 资料.bin');
const SIZE = 96 * 1024;
fs.writeFileSync(UPLOAD_PATH, Buffer.alloc(SIZE, 0x5a));
const expectedBytes = fs.statSync(UPLOAD_PATH).size;
const expectedName = path.basename(UPLOAD_PATH);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
const DL_FILE = path.join(DL_DIR, expectedName);

(async () => {
  console.log(`上传文件: ${UPLOAD_PATH}  (${expectedBytes} 字节)`);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-upl-'));
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

  let id = 0; const pend = new Map(); const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
    else if (m.method) {
      // confirm() 弹窗：自动点「确定」。必须在事件触发时响应，不能提前设置。
      if (m.method === 'Page.javascriptDialogOpening') {
        send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      } else {
        events.push(m);
      }
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Network.enable'); await send('Log.enable');
  // 让界面里的 <a>.click() 真的把文件落盘到 DL_DIR，方便我们核对字节
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (COOKIE && COOKIE !== true) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  // ---------- 1. 打开上传弹窗 ----------
  head('1. 打开上传弹窗');
  const before = await evalJs(`document.querySelectorAll('.cr-host #gridWrapper [data-id]').length`);
  console.log('  上传前条目数:', before);
  await evalJs(`document.querySelector('.cr-host #openUploadBtn').click()`);
  await sleep(900);
  const modalOpen = await evalJs(`!document.querySelector('#uploadModal').classList.contains('is-hidden')`);
  if (modalOpen) ok('弹窗打开了'); else { bad('弹窗没打开'); return finish(); }

  // ---------- 2. 选文件 ----------
  head('2. 选文件');
  const doc = await send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#filePickerInput' });
  if (!nodeId) { bad('找不到文件选择框'); return finish(); }
  await send('DOM.setFileInputFiles', { files: [UPLOAD_PATH], nodeId });
  await sleep(700);
  const picked = await evalJs(`(() => {
    const p = document.querySelector('#filePickerInput');
    const lbl = document.querySelector('#uploadDropText');
    return { hasFile: !!(p.files && p.files[0]), name: p.files && p.files[0] ? p.files[0].name : null,
             label: lbl ? lbl.textContent.trim() : null };
  })()`);
  console.log('  ', JSON.stringify(picked));
  if (picked.hasFile) ok('文件已选中: ' + picked.name); else { bad('文件没选上'); return finish(); }

  // ---------- 3. 提交（真实上传） ----------
  head('3. 提交（真实上传，走 XHR + 进度）');
  await evalJs(`document.querySelector('#modalSubmitBtn').click()`);
  let result = null;
  for (let i = 0; i < 40; i++) {
    await sleep(600);
    result = await evalJs(`(() => {
      const toast = [...document.querySelectorAll('#toastRoot .toast')].map(e => e.textContent.trim());
      const stillOpen = !document.querySelector('#uploadModal').classList.contains('is-hidden');
      const count = document.querySelectorAll('.cr-host #gridWrapper [data-id]').length;
      return { toast, stillOpen, count };
    })()`);
    if (!result.stillOpen || result.toast.length) break;
  }
  console.log('  ', JSON.stringify(result));
  const toastText = (result.toast || []).join(' | ');
  if (/已存入资料库/.test(toastText)) ok('后端返回成功：' + toastText.slice(0, 90));
  else bad('上传未成功，toast=' + toastText);
  if (!result.stillOpen) ok('上传成功后弹窗自动关闭');

  // ---------- 4. 列表里出现 ----------
  head('4. 列表出现新条目');
  const after = await evalJs(`(() => {
    const items = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')];
    const hit = items.filter(e => /${esc(expectedName)}/.test(e.textContent));
    return { count: items.length, matched: hit.length,
      title: hit[0] ? hit[0].querySelector('.card-title')?.textContent.trim() : null,
      id: hit[0] ? hit[0].dataset.id : null };
  })()`);
  console.log('  ', JSON.stringify(after));
  if (after.matched > 0) ok(`列表里出现了「${after.title}」（条目数 ${before} → ${after.count}）`);
  else { bad('列表里没有找到刚上传的文件'); return finish(); }

  // ---------- 5. 点真实「下载」按钮 -> 文件落盘，字节一致 ----------
  head('5. 点界面里的下载按钮（真实 <a> 下载）');
  if (fs.existsSync(DL_FILE)) fs.rmSync(DL_FILE);
  await evalJs(`(() => {
    const hit = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')]
      .find(e => /${esc(expectedName)}/.test(e.textContent));
    hit.querySelector('[data-download]').click();
  })()`);
  let dlBytes = -1;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (fs.existsSync(DL_FILE)) { dlBytes = fs.statSync(DL_FILE).size; if (dlBytes === expectedBytes) break; }
  }
  console.log('  落盘文件:', DL_FILE, '字节:', dlBytes, '预期:', expectedBytes);
  if (dlBytes === expectedBytes) ok(`下载按钮把原文件落盘，${dlBytes} 字节，与原文件一致`);
  else bad(`下载按钮落盘异常（${dlBytes} 字节 ≠ 预期 ${expectedBytes}）`);
  // 核对内容（不是导出 JSON）
  if (fs.existsSync(DL_FILE)) {
    const buf = fs.readFileSync(DL_FILE);
    const allSame = buf.every((b) => b === 0x5a);
    if (allSame) ok('内容逐字节一致（全是 0x5a，不是 JSON 导出）');
    else bad('下载内容不是原文件（疑似被导出成 JSON）');
  }

  // ---------- 6. 点真实「删除」按钮 ----------
  head('6. 点界面里的删除按钮（confirm 已自动确认）');
  await evalJs(`(() => {
    const hit = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')]
      .find(e => /${esc(expectedName)}/.test(e.textContent));
    hit.querySelector('[data-delete]').click();
  })()`);
  await sleep(2500);
  const afterDel = await evalJs(`(() => {
    const items = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')];
    const hit = items.filter(e => /${esc(expectedName)}/.test(e.textContent));
    return { count: items.length, matched: hit.length };
  })()`);
  console.log('  ', JSON.stringify(afterDel));
  if (afterDel.matched === 0) ok('点删除后，该条目从列表消失');
  else bad('点删除后条目仍在列表');

  // 跳走再跳回，确认是后端真删了（不是前端只是隐藏）
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(600);
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);
  const restored = await evalJs(`document.querySelectorAll('.cr-host #gridWrapper [data-id]').length`);
  // before 可能 > 0（环境里已有别的归档），这里只验证「刚上传的那条确实没了」
  const gone = await evalJs(`([...document.querySelectorAll('.cr-host #gridWrapper [data-id]')].every(e => !/${esc(expectedName)}/.test(e.textContent)))`);
  if (gone) ok('刷新后该文件不再出现（确认是从后端删掉的，非前端隐藏）');
  else bad('刷新后该文件又出现了');

  // ---------- 控制台 ----------
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown'
    || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  head('7. 控制台');
  if (!errs.length) ok('0 错误');
  else {
    bad(`${errs.length} 条错误`);
    errs.slice(0, 5).forEach((e) => {
      const txt = e.params.exceptionDetails?.exception?.description || e.params.entry?.text
        || (e.params.args || []).map((a) => a.value || a.description || '').join(' ');
      console.log('     ·', String(txt).replace(/\n/g, ' ').slice(0, 220));
    });
  }

  function finish() {
    console.log('\n══════════════════════════════════════════════════════');
    console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
    console.log('══════════════════════════════════════════════════════');
    try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { fs.rmSync(DL_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    process.exit(code);
  }
  finish();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
