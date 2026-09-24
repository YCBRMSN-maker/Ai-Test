#!/usr/bin/env node
/**
 * 遍历**所有课程的所有资料条目**，逐条打开预览，验证：
 *   ① 弹窗真的打开了（openPreview 没被异常打断）
 *   ② 舞台里有内容（专属预览器 或 兜底说明块）
 *   ③ 全程 0 控制台错误
 *
 * 为什么需要它：不同课程由不同来源产出（课程生成器 / 演示种子），
 * 同一个预览器在不同课程的数据形状下可能挂掉。
 * 曾经 `pvCode` 在「没有 files 字段」的 code 场景上抛错，
 * 导致**点编程练习弹窗根本打不开** —— 而只测单一课程时完全发现不了。
 *
 * 用法： node tools/check-all-previews.js <url> --cookie=pbl_session=xxx
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
const PORT = 9900 + (process.pid % 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════'); };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
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
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { errs.push('console: ' + (m.params.args || []).map((a) => a.value || a.description || '').join(' ')); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval'); return r.result.value; };

  await Promise.all([send('Page.enable'), send('Runtime.enable')]);
  const token = (COOKIE && COOKIE !== true) ? COOKIE.split('=').slice(1).join('=') : '';
  if (!token) { console.error('FATAL: 缺少 --cookie=pbl_session=xxx'); process.exit(1); }
  await send('Network.setCookie', { name: 'pbl_session', value: token, domain: '127.0.0.1', path: '/' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  const courseCards = await ev("Array.from(document.querySelectorAll('#courseCardGrid [data-course]')).map(function(c){return {id:c.dataset.course, name:(c.querySelector('h4')||{}).textContent||''};})");
  head(`遍历 ${courseCards.length} 门课程的所有条目`);
  const failures = [];
  let total = 0;

  for (const c of courseCards) {
    await ev("(function(){var b=document.querySelector('#courseCardGrid [data-course=\"" + c.id + "\"]');if(b)b.click();})()");
    await sleep(800);
    const ids = await ev("Array.from(document.querySelectorAll('#gridWrapper [data-id]')).map(function(e){return e.dataset.id;})");
    let badInCourse = 0;
    for (const itemId of ids) {
      total++;
      await ev("(function(){var x=document.getElementById('previewClose');if(x&&!document.getElementById('previewModal').classList.contains('is-hidden'))x.click();})()");
      await sleep(90);
      const errBefore = errs.length;
      await ev("(function(){var t=document.querySelector('#gridWrapper [data-preview=\"" + itemId + "\"]');if(t)t.click();})()");
      await sleep(330);
      const st = await ev("(function(){var m=document.getElementById('previewModal');var s=document.getElementById('previewStage');var fb=document.getElementById('previewFallback');" +
        "return {open:!m.classList.contains('is-hidden'), kids:s?s.children.length:-1," +
        "fbShown: fb?!fb.classList.contains('is-hidden'):false," +
        "badge:(document.getElementById('previewBadge')||{}).textContent||''," +
        "title:(document.getElementById('previewTitle')||{}).textContent||''};})()");
      // 光「弹窗打开了」不够 —— 还要确认对应预览器里**真有内容**（防止「打开了但是空的」）
      const contentOk = await ev("(function(){var b=(document.getElementById('previewBadge')||{}).textContent||'';" +
        "function txt(sel){var e=document.querySelector(sel);return e?(e.innerText||'').length:0;}" +
        "if(b==='代码')  return txt('.pv-code-src') > 10;" +
        "if(b==='大纲')  return txt('.pv-a4') > 50;" +
        "if(b==='视频')  {var e=document.querySelector('.pv-chapters');return e?e.children.length>0:false;}" +
        "if(b==='课件')  return txt('.pv-slide') > 5;" +
        "if(b==='测验')  return txt('#pvQList') > 10;" +
        // 小节讲义 → Markdown 阅读器；总览/交互 → iframe（sandbox 下父页读不到 contentDocument，
        // 所以查 srcdoc 长度与渲染尺寸，别查 innerText）
        "if(b==='讲义')  return txt('.pv-md-doc') > 20 && document.querySelectorAll('.pv-md-toc a').length > 0;" +
        "if(b==='总览'||b==='交互'){var f=document.querySelector('.pv-iframe');if(!f)return false;" +
        "  var r=f.getBoundingClientRect();return (f.getAttribute('srcdoc')||'').length > 50 && r.width > 100 && r.height > 100;}" +
        // 学习路径 / 知识图谱 → 图结构；完整归档包 → JSON 树
        "if(b==='归档')  return !!(document.querySelector('.pv-graph')||document.querySelector('.pv-tree'));" +
        "return true;})()");
      const visible = st.open && (st.kids > 0 || st.fbShown);
      const newErr = errs.length > errBefore;
      if (!visible || !contentOk || newErr) {
        badInCourse++;
        failures.push({ course: c.name, id: itemId, badge: st.badge, title: st.title, open: st.open, stageKids: st.kids, fbShown: st.fbShown, contentOk: contentOk, newErr: newErr });
      }
    }
    if (badInCourse === 0) ok(`${c.name}：${ids.length} 条全部可打开`);
    else bad(`${c.name}：${ids.length} 条里有 ${badInCourse} 条打不开 / 报错`);
  }

  head('结果');
  console.log(`  共遍历 ${total} 条条目`);
  if (failures.length) {
    bad(`${failures.length} 条异常：`);
    failures.slice(0, 12).forEach((f) => console.log(`   · [${f.badge}] ${f.title}（open=${f.open} stage=${f.stageKids} fallback=${f.fbShown} err=${f.newErr}）`));
  } else ok('全部条目都能正常打开且无控制台错误');
  if (errs.length) { bad(`控制台共 ${errs.length} 条错误`); errs.slice(0, 4).forEach((e) => console.log('   ·', String(e).replace(/\n/g, ' ').slice(0, 160))); }
  else ok('控制台 0 错误');

  console.log('\n══════════════════════════════════════════');
  console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
  console.log('══════════════════════════════════════════');
  try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
  process.exit(code);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
