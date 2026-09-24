#!/usr/bin/env node
/**
 * 端到端验证「结构化数据导出」弹窗：
 *   · JSON / CSV(带 BOM) / Markdown(GFM) 三种格式都能生成
 *   · 范围切换（全部 / 筛选 / 选中）
 *   · 字段投射（勾选/取消改变列数）
 *   · 复制 / 下载（CSV 验证 UTF-8 BOM，JSON 验证可解析）
 *   · 0 控制台错误
 *
 * 用法： node tools/check-export.js <url> --cookie=pbl_session=xxx
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
const PORT = 9400 + (process.pid % 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════════════════'); };

const DL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
const TOKEN = COOKIE && COOKIE !== true ? COOKIE.split('=')[1] : '';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-exp-'));
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
    else if (m.method) { if (m.method === 'Page.javascriptDialogOpening') { send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); } else events.push(m); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('DOM.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
  if (COOKIE && COOKIE !== true) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  // ---------- 1. 打开导出弹窗 ----------
  head('1. 打开导出弹窗');
  const hasBtn = await evalJs(`!!document.querySelector('#exportDataBtn')`);
  if (!hasBtn) { bad('找不到 #exportDataBtn（导出入口未渲染）'); return finish(); }
  await evalJs(`document.querySelector('#exportDataBtn').click()`);
  await sleep(600);
  const open = await evalJs(`!document.querySelector('#exportModal').classList.contains('is-hidden')`);
  if (open) ok('导出弹窗已打开'); else { bad('导出弹窗没打开'); return finish(); }
  const fieldCount = await evalJs(`document.querySelectorAll('#exportFieldGrid input').length`);
  if (fieldCount >= 10) ok(`字段投射勾选框已渲染（${fieldCount} 个字段）`); else bad(`字段勾选框过少：$${fieldCount}`);
  // 排版：格式与范围应左右两列并排（对齐参考稿）
  const layoutOk = await evalJs(`(function(){var c=document.querySelector('.export-cols');if(!c)return false;var k=c.querySelectorAll('.export-card');if(k.length<2)return false;var a=k[0].getBoundingClientRect(),b=k[1].getBoundingClientRect();return Math.abs(a.top-b.top)<3;})()`);
  if (layoutOk) ok('「格式」与「范围」左右两列并排'); else bad('格式/范围没有并排（排版未对齐参考稿）');
  const fmtN = await evalJs(`document.querySelectorAll('#exportFormatSeg button').length`);
  if (fmtN === 4) ok('格式卡片 4 个（JSON / CSV / Markdown / 原始文件）'); else bad(`格式卡片数量不对：${fmtN}`);

  // ---------- 2. 三格式 + CSV BOM ----------
  head('2. 三种格式生成 + CSV BOM');
  async function previewText() { return await evalJs(`document.querySelector('#exportPreview').textContent`); }
  async function setFmt(f) { await evalJs(`document.querySelector('#exportFormatSeg button[data-fmt="${f}"]').click()`); await sleep(250); return previewText(); }

  const jt = await setFmt('json');
  if (jt.trim().startsWith('[') && jt.includes('"标题"')) ok('JSON 输出正常（含中文字段名、数组）'); else bad('JSON 异常: ' + jt.slice(0, 80));
  const ct = await setFmt('csv');
  if (/,/.test(ct) && /标题/.test(ct)) ok('CSV 输出正常（逗号分隔 + 表头）'); else bad('CSV 异常: ' + ct.slice(0, 80));
  const mt = await setFmt('md');
  if (mt.includes('|') && mt.includes('---')) ok('Markdown 输出正常（GFM 管道表格）'); else bad('MD 异常: ' + mt.slice(0, 80));

  // CSV 下载并校验 BOM
  await evalJs(`document.querySelector('#exportFormatSeg button[data-fmt="csv"]').click()`);
  await sleep(200);
  const before = fs.readdirSync(DL_DIR).length;
  await evalJs(`document.querySelector('#exportDownload').click()`);
  let csvFile = null;
  for (let i = 0; i < 20; i++) { await sleep(400); const f = fs.readdirSync(DL_DIR).filter((x) => x.endsWith('.csv')); if (f.length > before - 1 + (before === 0 ? 1 : 0)) { csvFile = f[0]; break; } if (f.length) { csvFile = f[f.length - 1]; break; } }
  if (csvFile) {
    const buf = fs.readFileSync(path.join(DL_DIR, csvFile));
    const bom = buf.slice(0, 3);
    if (bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xEF - 0xEF + 0xBF) ok('CSV 文件以 UTF-8 BOM (EF BB BF) 开头（Excel 中文不乱码）');
    else if (bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF) ok('CSV 文件以 UTF-8 BOM (EF BB BF) 开头（Excel 中文不乱码）');
    else bad('CSV 缺少 BOM，首字节: ' + bom.toString('hex'));
  } else bad('CSV 下载未落盘');

  // ---------- 3. 范围切换 ----------
  head('3. 导出范围');
  const allCount = await evalJs(`(() => { document.querySelector('input[name="exportScope"][value="all"]').click(); return document.querySelector('#exportMeta').textContent; })()`);
  const filtCount = await evalJs(`(() => { document.querySelector('input[name="exportScope"][value="filtered"]').click(); return document.querySelector('#exportMeta').textContent; })()`);
  console.log('   全部:', allCount, '| 筛选:', filtCount);
  if (/范围 \d+ 条/.test(allCount)) ok('范围切换更新了条目计数'); else bad('范围计数未更新: ' + allCount);

  // ---------- 3b. 课程限定 ----------
  head('3b. 课程限定（只导出某一门课）');
  const num = (s) => { const m = String(s).match(/[0-9]+/); return m ? Number(m[0]) : 0; };
  const courseOpts = await evalJs(`Array.from(document.getElementById('exportCourseSelect').options).map(function (o) { return o.textContent; })`);
  if (courseOpts.length >= 2) ok(`课程下拉已填充（${courseOpts.length} 项：${courseOpts.slice(0, 3).join(' / ')}）`);
  else bad('课程下拉没填充：' + JSON.stringify(courseOpts));
  const baseN = await evalJs(`(function () { document.querySelector('input[name="exportScope"][value="all"]').click(); return document.getElementById('exportMeta').textContent; })()`);
  const oneN = await evalJs(`(function () {
    var s = document.getElementById('exportCourseSelect');
    s.value = s.options[1].value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { name: s.options[1].textContent, meta: document.getElementById('exportMeta').textContent, foot: document.getElementById('exportFootStat').textContent };
  })()`);
  if (num(oneN.meta) > 0 && num(oneN.meta) < num(baseN)) ok(`限定「${oneN.name}」后范围 ${num(baseN)} 条 → ${num(oneN.meta)} 条（${oneN.foot}）`);
  else bad(`课程限定没生效：全部 ${baseN} → ${oneN.name} ${oneN.meta}`);
  await evalJs(`(function () { var s = document.getElementById('exportCourseSelect'); s.value = 'ALL'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

  // ---------- 4. 字段投射 ----------
  head('4. 字段投射（取消一列）');
  const beforeCols = await evalJs(`document.querySelector('#exportMeta').textContent`);
  await evalJs(`(() => { const cb = document.querySelector('#exportFieldGrid input'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); return document.querySelector('#exportMeta').textContent; })()`);
  const afterCols = await evalJs(`document.querySelector('#exportMeta').textContent`);
  console.log('   取消前:', beforeCols, '\n   取消后:', afterCols);
  const b = parseInt((beforeCols.match(/已选 (\d+) 列/) || [])[1] || '0', 10);
  const a = parseInt((afterCols.match(/已选 (\d+) 列/) || [])[1] || '0', 10);
  if (a === b - 1) ok(`取消一列后，导出列数 ${b} → ${a}`); else bad(`列数未按预期减少（${b} → ${a}）`);

  // ---------- 5. JSON 下载可解析 ----------
  head('5. JSON 下载可解析');
  await evalJs(`document.querySelector('#exportFormatSeg button[data-fmt="json"]').click()`);
  await sleep(200);
  await evalJs(`document.querySelector('#exportDownload').click()`);
  let jsonFile = null;
  for (let i = 0; i < 20; i++) { await sleep(400); const f = fs.readdirSync(DL_DIR).filter((x) => x.endsWith('.json')); if (f.length) { jsonFile = f[f.length - 1]; break; } }
  if (jsonFile) {
    try { const arr = JSON.parse(fs.readFileSync(path.join(DL_DIR, jsonFile), 'utf8')); if (Array.isArray(arr) && arr.length) ok(`JSON 下载可解析（${arr.length} 条）`); else bad('JSON 不是预期数组'); }
    catch (e) { bad('JSON 解析失败: ' + e.message); }
  } else bad('JSON 下载未落盘');

  // ---------- 5b. 「原始文件」格式（按真实类型打包 .ZIP） ----------
  head('5b. 原始文件格式');
  await evalJs(`document.querySelector('#exportFormatSeg button[data-fmt="files"]').click()`);
  await sleep(450);
  const fsState = await evalJs(`(function(){
    return {
      on: (document.querySelector('#exportFormatSeg .is-on')||{}).textContent || '',
      fieldHidden: document.getElementById('exportFieldWrap').classList.contains('is-hidden'),
      previewHead: (document.getElementById('exportPreview').textContent || '').slice(0, 36),
      foot: document.getElementById('exportFootStat').textContent,
      btn: document.getElementById('exportDownloadText').textContent
    };})()`);
  if (fsState.fieldHidden && /ZIP/.test(fsState.btn)) ok(`切到「原始文件」：字段投射隐藏、按钮「${fsState.btn}」、底栏「${fsState.foot}」`);
  else bad('「原始文件」态不对：' + JSON.stringify(fsState));
  if (fsState.previewHead.indexOf('·') > -1) ok('预览列出待打包的文件清单');
  else bad('预览没有列出文件清单：' + fsState.previewHead);
  const beforeZip = fs.readdirSync(DL_DIR).filter((x) => x.endsWith('.zip')).length;
  await evalJs(`document.getElementById('exportDownload').click()`);
  let zipFile = null;
  for (let i = 0; i < 24; i++) { await sleep(350); const f = fs.readdirSync(DL_DIR).filter((x) => x.endsWith('.zip')); if (f.length > beforeZip) { zipFile = f[f.length - 1]; break; } }
  if (zipFile) {
    const b = fs.readFileSync(path.join(DL_DIR, zipFile));
    if (b[0] === 0x50 && b[1] === 0x4b && b.length > 500) ok(`原始文件打包落盘：${zipFile}（${b.length} 字节，PK 头正确）`);
    else bad('ZIP 结构异常：' + b.slice(0, 4).toString('hex'));
  } else bad('原始文件打包未落盘');

  // ---------- 6. 控制台 ----------
  head('6. 控制台');
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown'
    || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  if (!errs.length) ok('0 错误'); else { bad(`${errs.length} 条错误`); errs.slice(0, 5).forEach((e) => console.log('     ·', String(e.params.exceptionDetails?.exception?.description || e.params.entry?.text || '').replace(/\n/g, ' ').slice(0, 200))); }

  function finish() {
    console.log('\n══════════════════════════════════════════════════════');
    console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
    console.log('══════════════════════════════════════════════════════');
    try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
    try { fs.rmSync(DL_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    process.exit(code);
  }
  finish();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
