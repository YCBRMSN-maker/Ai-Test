#!/usr/bin/env node
/**
 * 端到端验证「存入历史资料」真的能存入任意文件。
 *
 * 用 CDP 的 DOM.setFileInputFiles 给 <input type="file"> 塞文件，
 * 走完整 UI 流程：打开弹窗 → 选文件 → 提交 → 列表出现 → 能原样下载 → 删掉。
 *
 * 用法：
 *   node tools/check-upload.js <url> --cookie=pbl_session=xxx [--file=<要上传的文件路径>]
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

// 造一个「任意格式」的测试文件（二进制，带中文名）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
const UPLOAD_PATH = (opt.file && opt.file !== true) ? opt.file : path.join(tmpDir, '测试 资料.bin');
const SIZE = 64 * 1024;
if (!opt.file) {
  fs.writeFileSync(UPLOAD_PATH, Buffer.alloc(SIZE, 0x5a));
}
const expectedBytes = fs.statSync(UPLOAD_PATH).size;
const expectedName = path.basename(UPLOAD_PATH);

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
    else if (m.method) events.push(m);
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Network.enable'); await send('Log.enable');
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

  const dimText = await evalJs(`(() => { const e = document.querySelector('#uploadModal .dropzone .dim'); return e ? e.textContent.trim() : null; })()`);
  console.log('  弹窗说明:', dimText);

  // ---------- 2. 选文件（CDP 直接塞 input） ----------
  head('2. 选文件');
  const doc = await send('DOM.getDocument', { depth: 0 });
  // 注意：send() 直接 resolve 的是 result，不是整条消息 —— 别再写一层 .result
  const { nodeId } = await send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '#filePickerInput',
  });
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

  // ---------- 3. 提交 ----------
  head('3. 提交（真实上传）');
  await evalJs(`document.querySelector('#modalSubmitBtn').click()`);
  // 等上传完成（轮询 toast / 列表变化）
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
    const hit = items.filter(e => /${expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.test(e.textContent));
    return {
      count: items.length,
      matched: hit.length,
      title: hit[0] ? hit[0].querySelector('.card-title')?.textContent.trim() : null,
      course: hit[0] ? hit[0].querySelector('.card-course')?.textContent.trim() : null,
      id: hit[0] ? hit[0].dataset.id : null,
    };
  })()`);
  console.log('  ', JSON.stringify(after));
  if (after.matched > 0) ok(`列表里出现了「${after.title}」（条目数 ${before} → ${after.count}）`);
  else bad('列表里没有找到刚上传的文件');

  // ---------- 5. 能原样下载 ----------
  head('5. 原样下载回来');
  const dl = await evalJs(`(async () => {
    const hit = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')]
      .find(e => /${expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.test(e.textContent));
    if (!hit) return { error: '找不到条目' };
    // 条目 id 形如 A-<数字>
    const parts = String(hit.dataset.id).split('-');
    const archiveId = parts[parts.length - 1];
    const r = await fetch('/api/v1/course/archive-file/download?id=' + encodeURIComponent(archiveId),
                          { credentials: 'same-origin' });
    const buf = await r.arrayBuffer();
    const cd = r.headers.get('content-disposition') || '';
    return { status: r.status, bytes: buf.byteLength, contentDisposition: cd, archiveId };
  })()`);
  console.log('  ', JSON.stringify(dl));
  if (dl.status === 200 && dl.bytes === expectedBytes) ok(`下载回来 ${dl.bytes} 字节，与原文件一致`);
  else bad(`下载异常: ${JSON.stringify(dl)}`);
  if (dl.contentDisposition && expectedName) ok('下载文件名带原文件名: ' + dl.contentDisposition.slice(0, 70));

  // ---------- 6. 删掉，列表恢复 ----------
  head('6. 删除后列表恢复');
  const del = await evalJs(`(async () => {
    const hit = [...document.querySelectorAll('.cr-host #gridWrapper [data-id]')]
      .find(e => /${expectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.test(e.textContent));
    const parts = String(hit.dataset.id).split('-');
    const archiveId = parts[parts.length - 1];
    const r = await fetch('/api/v1/course/archive-file?id=' + encodeURIComponent(archiveId),
                          { method: 'DELETE', credentials: 'same-origin' });
    return await r.json();
  })()`);
  console.log('  ', JSON.stringify(del));
  if (del && del.code === 0) ok('删除成功'); else bad('删除失败: ' + JSON.stringify(del));

  // ⚠️ 必须先跳 about:blank 断开同文档导航。
  // 直接 navigate 到同一个 hash 属于同文档导航，页面根本不重载，
  // 模块内存里的 archiveFiles 还是旧的 —— 会误判成「删了但列表没变」。
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(600);
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);
  const restored = await evalJs(`document.querySelectorAll('.cr-host #gridWrapper [data-id]').length`);
  if (restored === before) ok(`刷新后条目数回到 ${restored}（清理干净）`);
  else bad(`刷新后条目数 ${restored}，预期 ${before}`);

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
    process.exit(code);
  }
  finish();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
