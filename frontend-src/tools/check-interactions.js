#!/usr/bin/env node
/**
 * 课程资源管理页 · 交互联动专项测试（课程优先导航下的全量交互）
 *
 * 覆盖：
 *   A. 课程优先导航（默认只显示课程 → 点课程露资料 → 返回）
 *   B. 学期卡片切换 + 横向平滑滚动（箭头只在滚得动时出现）
 *   C. 资料类型胶囊切换
 *   D. 排序切换
 *   E. 卡片网格 / 表格清单 双视图无缝切换
 *   F. 多选浮动舱联动（勾选 → 计数 → 全选 → 清空）
 *   G. 搜索框实时过滤
 *   H. 重置筛选
 *   I. 0 控制台错误
 *
 * 用法： node tools/check-interactions.js <url> --cookie=pbl_session=xxx
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
const PORT = 9600 + (process.pid % 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════'); };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-'));
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
  if (COOKIE && COOKIE !== true) {
    const [n, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name: n, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL_ });
  await sleep(9000);

  const cnt = () => ev("document.querySelectorAll('.cr-host #gridWrapper [data-id]').length");

  // ---------- A. 课程优先导航 ----------
  head('A. 课程优先导航');
  const a1 = await ev("(function(){return {cards:document.querySelectorAll('#courseCardGrid [data-course]').length, areaHidden:document.getElementById('resourceArea').classList.contains('is-hidden'), hintHidden:document.getElementById('courseEmptyHint').classList.contains('is-hidden')};})()");
  if (a1.cards > 0 && a1.areaHidden && !a1.hintHidden) ok(`默认只显示 ${a1.cards} 门课程，资料区隐藏（符合「先看课程」）`);
  else bad(`默认态不对：课程卡=${a1.cards} 资料区隐藏=${a1.areaHidden} 提示隐藏=${a1.hintHidden}`);
  await ev("(function(){var g=document.getElementById('courseCardGrid');var c=Array.from(g.children).filter(function(x){return /CS-401/.test(x.textContent);})[0];c.click();})()");
  await sleep(700);
  const a2 = await ev("(function(){return {areaHidden:document.getElementById('resourceArea').classList.contains('is-hidden'), backHidden:document.getElementById('backToCoursesBtn').classList.contains('is-hidden'), items:document.querySelectorAll('.cr-host #gridWrapper [data-id]').length};})()");
  if (!a2.areaHidden && !a2.backHidden && a2.items > 0) ok(`点开课程后露出资料区（${a2.items} 条）并出现「全部课程」返回`);
  else bad(`点开课程后不对：资料区隐藏=${a2.areaHidden} 返回隐藏=${a2.backHidden} 条目=${a2.items}`);
  const totalAll = await cnt();

  // ---------- B. 学期卡片切换 + 横向滚动 ----------
  head('B. 学期卡片切换 + 横向平滑滚动');
  const b1 = await ev("(function(){var cards=document.querySelectorAll('#semesterCardGrid .sem-card');var target=cards[cards.length-1];var label=target.textContent.trim();target.click();return {label:label,on:target.classList.contains('is-on')};})()");
  await sleep(400);
  const b2 = await ev("(function(){return {onCount:document.querySelectorAll('#semesterCardGrid .sem-card.is-on').length, items:document.querySelectorAll('.cr-host #gridWrapper [data-id]').length};})()");
  if (b2.onCount === 1) ok(`点击学期卡「${b1.label.split('资料')[0].trim()}」后选中态唯一（列表 ${b2.items} 条）`);
  else bad(`学期卡选中态异常：${b2.onCount} 个 is-on`);
  // 造出溢出 → 箭头应出现并能滚动
  const b3 = await ev(`(async () => {
    const g = document.querySelector('#semesterCardGrid');
    const prev = document.querySelector('#semScrollPrev'), next = document.querySelector('#semScrollNext');
    const tpl = g.children[0] ? g.children[0].outerHTML : '';
    for (let i = 0; i < 8; i++) g.insertAdjacentHTML('beforeend', tpl);
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 300));
    const before = g.scrollLeft;
    next.click();
    await new Promise(r => setTimeout(r, 900));
    const moved = Math.round(g.scrollLeft - before);
    prev.click();
    await new Promise(r => setTimeout(r, 900));
    return { scrollable: g.scrollWidth - g.clientWidth, arrow: getComputedStyle(prev).display, moved: moved, back: Math.round(g.scrollLeft) };
  })()`);
  if (b3.scrollable > 1 && b3.arrow !== 'none') ok(`学期溢出时左右箭头出现（可滚动 ${b3.scrollable}px）`);
  else bad(`学期溢出后箭头没出现（可滚动=${b3.scrollable}, display=${b3.arrow}）`);
  if (b3.moved > 0 && b3.back === 0) ok(`点箭头横向平滑滚动 ${b3.moved}px 且能滚回起点`);
  else bad(`横向滚动异常：moved=${b3.moved} back=${b3.back}`);

  // ---------- C. 类型胶囊 ----------
  head('C. 资料类型胶囊切换');
  const c1 = await ev("(function(){var pills=document.querySelectorAll('#categoryTabs .pill');var p=Array.from(pills).filter(function(x){return /讲解课件/.test(x.textContent);})[0];p.click();return {n:pills.length,label:p.textContent.trim()};})()");
  await sleep(400);
  const c2 = await ev("(function(){return {on:document.querySelector('#categoryTabs .pill.is-on').textContent.trim(), items:document.querySelectorAll('.cr-host #gridWrapper [data-id]').length};})()");
  if (c2.on.indexOf('讲解课件') > -1 && c2.items > 0 && c2.items < totalAll) ok(`切到「讲解课件」后列表收敛为 ${c2.items} 条（全部 ${totalAll} 条）`);
  else bad(`胶囊切换异常：is-on=${c2.on} 条目=${c2.items}（全部 ${totalAll}）`);
  // 不变量：胶囊上的数字必须等于「点进去会看到多少条」。
  // 曾经这里是全局统计、列表只算当前课程 → 「有数字但点进去是空的」。
  // ⚠️ 每次点胶囊都会重渲染整排胶囊（innerHTML 重建），所以**不能缓存节点** ——
  // 缓存下来的旧节点已脱离 DOM，再点它不会触发委托到 #categoryTabs 上的处理器。
  // 必须每轮按 data-cat 重新查询。
  const cats = await ev("Array.from(document.querySelectorAll('#categoryTabs .pill')).map(function (p) { return p.dataset.cat; })");
  const pillCheck = [];
  for (const cat of cats) {
    await ev("(function () { var b = document.querySelector('#categoryTabs .pill[data-cat=\"" + cat + "\"]'); if (b) b.click(); })()");
    await sleep(300);
    const r = await ev("(function () { var b = document.querySelector('#categoryTabs .pill[data-cat=\"" + cat + "\"]'); var n = (b && b.querySelector('.pill-n')) ? Number(b.querySelector('.pill-n').textContent) : 0; return { badge: n, items: document.querySelectorAll('.cr-host #gridWrapper [data-id]').length }; })()");
    pillCheck.push({ cat: cat, badge: r.badge, items: r.items });
  }
  const mismatch = pillCheck.filter((x) => x.badge !== x.items);
  if (!mismatch.length) ok(`${pillCheck.length} 个胶囊的数字都等于点进去的条数（${pillCheck.map((x) => x.badge).join(' / ')}）`);
  else bad('胶囊数字与列表不一致：' + JSON.stringify(mismatch));

  // ---------- D. 排序 ----------
  head('D. 排序切换');
  // 先复位到「全部归档资料」，再比较「最新优先」与「内容体积大到小」的整体顺序。
  // 注意：同一门课里所有条目归档时间相同，newest 与 chapter 的结果**本来就一致**，
  // 用它们对比会误判成「排序没生效」，所以这里用体积排序。
  await ev("document.querySelector('#categoryTabs .pill').click()");
  await sleep(300);
  const seq = "Array.from(document.querySelectorAll('.cr-host #gridWrapper [data-id] .card-title')).map(function(e){return e.textContent;}).join('|')";
  const orderBefore = await ev(seq);
  await ev("(function(){var s=document.getElementById('sortBySelect');s.value='size';s.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await sleep(400);
  const orderAfter = await ev(seq);
  if (orderBefore !== orderAfter && orderAfter.length > 0) ok('切到「内容体积：大到小」后列表整体顺序发生变化');
  else bad('排序切换后顺序没变');

  // ---------- E. 双视图 ----------
  head('E. 卡片网格 / 表格清单 双视图');
  await ev("document.querySelector('#viewSeg button[data-view=\"list\"]').click()");
  await sleep(400);
  const e1 = await ev("(function(){return {gridHidden:document.getElementById('gridWrapper').classList.contains('is-hidden'), tableHidden:document.getElementById('tableWrapper').classList.contains('is-hidden'), rows:document.querySelectorAll('#tableBody tr[data-id]').length};})()");
  if (e1.gridHidden && !e1.tableHidden && e1.rows > 0) ok(`切到清单视图：网格隐藏、表格显示（${e1.rows} 行）`);
  else bad(`清单视图异常：grid隐藏=${e1.gridHidden} table隐藏=${e1.tableHidden} 行=${e1.rows}`);
  await ev("document.querySelector('#viewSeg button[data-view=\"grid\"]').click()");
  await sleep(400);
  const e2 = await ev("(function(){return {gridHidden:document.getElementById('gridWrapper').classList.contains('is-hidden'), tableHidden:document.getElementById('tableWrapper').classList.contains('is-hidden')};})()");
  if (!e2.gridHidden && e2.tableHidden) ok('切回卡片视图正常');
  else bad(`卡片视图异常：grid隐藏=${e2.gridHidden} table隐藏=${e2.tableHidden}`);

  // ---------- F. 多选浮动舱 ----------
  head('F. 多选浮动舱联动');
  const f0 = await ev("document.getElementById('batchDock').classList.contains('is-hidden')");
  const f1 = await ev("(function(){var cbs=document.querySelectorAll('.cr-host #gridWrapper [data-check]');cbs[0].click();cbs[1].click();cbs[2].click();return document.getElementById('dockSelectedCount').textContent;})()");
  await sleep(400);
  const f2 = await ev("(function(){return {count:document.getElementById('dockSelectedCount').textContent, dockShown:!document.getElementById('batchDock').classList.contains('is-hidden')};})()");
  if (f2.count === '3' && f2.dockShown) ok(`勾选 3 张卡后浮动舱出现并计数 = ${f2.count}`);
  else bad(`浮动舱计数异常：count=${f2.count} 显示=${f2.dockShown}（初始隐藏=${f0}）`);
  await ev("document.getElementById('dockClear').click()");
  await sleep(400);
  const f3 = await ev("(function(){return {count:document.getElementById('dockSelectedCount').textContent, dockHidden:document.getElementById('batchDock').classList.contains('is-hidden'), checked:document.querySelectorAll('.cr-host #gridWrapper [data-check]:checked').length};})()");
  if (f3.count === '0' && f3.dockHidden && f3.checked === 0) ok('点「取消选择」后浮动舱隐藏、计数归零、勾选清空');
  else bad(`清空选择异常：count=${f3.count} 隐藏=${f3.dockHidden} 仍勾选=${f3.checked}`);
  // 表格视图里的全选
  await ev("document.querySelector('#viewSeg button[data-view=\"list\"]').click()");
  await sleep(400);
  const f4 = await ev("(function(){var s=document.getElementById('selectAllRows');s.click();return document.getElementById('dockSelectedCount').textContent;})()");
  await sleep(400);
  const f5 = await ev("(function(){return {count:document.getElementById('dockSelectedCount').textContent, rows:document.querySelectorAll('#tableBody tr[data-id]').length};})()");
  if (Number(f5.count) === f5.rows && f5.rows > 0) ok(`清单视图「全选」联动：${f5.count} / ${f5.rows} 行`);
  else bad(`全选联动异常：count=${f5.count} rows=${f5.rows}`);
  await ev("document.getElementById('dockClear').click()");
  await sleep(300);
  await ev("document.querySelector('#viewSeg button[data-view=\"grid\"]').click()");
  await sleep(300);

  // ---------- G. 搜索实时过滤 ----------
  head('G. 搜索框实时过滤');
  const g1 = await ev("(function(){var i=document.getElementById('globalSearch');i.value='Raft';i.dispatchEvent(new Event('input',{bubbles:true}));return null;})()");
  await sleep(500);
  const g2 = await ev("(function(){var t=Array.from(document.querySelectorAll('.cr-host #gridWrapper [data-id] .card-title')).map(function(e){return e.textContent;});return {n:t.length, allRaft:t.every(function(x){return /Raft/.test(x);})};})()");
  if (g2.n > 0 && g2.allRaft) ok(`输入「Raft」实时过滤为 ${g2.n} 条，且全部命中`);
  else bad(`搜索过滤异常：${g2.n} 条，全部命中=${g2.allRaft}`);
  await ev("(function(){var i=document.getElementById('globalSearch');i.value='zzz-不存在-zzz';i.dispatchEvent(new Event('input',{bubbles:true}));return null;})()");
  await sleep(400);
  const g3 = await ev("!document.getElementById('emptyView').classList.contains('is-hidden')");
  if (g3) ok('无匹配时显示空态');
  else bad('无匹配时没显示空态');

  // ---------- H. 重置筛选 ----------
  head('H. 重置筛选');
  await ev("document.getElementById('resetBtn').click()");
  await sleep(500);
  const h1 = await ev("(function(){return {search:document.getElementById('globalSearch').value, items:document.querySelectorAll('.cr-host #gridWrapper [data-id]').length};})()");
  if (h1.search === '' && h1.items > 0) ok(`重置后搜索清空、列表恢复 ${h1.items} 条`);
  else bad(`重置异常：搜索="${h1.search}" 条目=${h1.items}`);

  // ---------- J. 指标卡图标居中 ----------
  head('J. 指标卡图标居中在色块里');
  // 曾经 `.stat span.tone-*`（给数字下方小字用的规则）**误命中**同样带 tone-* 的图标 span，
  // 把它的 display 从 grid 顶成 inline-flex → place-items 失效 → 图标贴左偏 9px。
  const statAlign = await ev(`(function(){
    var out=[];
    document.querySelectorAll('.cr-host .stat-icon').forEach(function(box){
      var ico=box.querySelector('iconify-icon'); if(!ico) return;
      var b=box.getBoundingClientRect(), i=ico.getBoundingClientRect();
      out.push({ dx: Math.round((i.left+i.width/2)-(b.left+b.width/2)),
                 dy: Math.round((i.top+i.height/2)-(b.top+b.height/2)),
                 display: getComputedStyle(box).display,
                 overflow: (i.left<b.left-0.5||i.right>b.right+0.5||i.top<b.top-0.5||i.bottom>b.bottom+0.5) });
    });
    return out;})()`);
  const offAlign = statAlign.filter((x) => Math.abs(x.dx) > 1 || Math.abs(x.dy) > 1 || x.overflow);
  if (statAlign.length && !offAlign.length) ok(`${statAlign.length} 个指标卡图标都居中在色块里（display=${statAlign[0].display}）`);
  else bad('指标卡图标未居中：' + JSON.stringify(offAlign));

  // ---------- I. 控制台 ----------
  head('I. 控制台');
  if (!errs.length) ok('0 错误');
  else { bad(`${errs.length} 条错误`); errs.slice(0, 4).forEach((e) => console.log('   ·', String(e).replace(/\n/g, ' ').slice(0, 180))); }

  console.log('\n══════════════════════════════════════════');
  console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
  console.log('══════════════════════════════════════════');
  try { ws.close(); proc.kill(); } catch (e) { /* ignore */ }
  process.exit(code);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
