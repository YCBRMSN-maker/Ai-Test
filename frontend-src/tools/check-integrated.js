#!/usr/bin/env node
/**
 * 验证「课程资源管理页并入 teacher-dist 之后」在真实应用里的表现。
 *
 * 检查项：
 *   A. 侧栏菜单项存在，且计算样式与原生菜单项一致
 *   B. 点击 → 路由正确 + 页面真的渲染出内容
 *   C. 数据来源：接口推导条目数 = 页面渲染条目数（不是内置假数据）
 *   D. 离开页面 → 浮层清理干净、没有残留
 *   E. 整页刷新直达 #/course-resources
 *   F. 控制台错误 / 外部请求 / 图标渲染
 *   G. 原有页面未被影响（首页仍正常）
 *
 * 用法：
 *   node tools/check-integrated.js [url] [--cookie=pbl_session=xxx]
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
const URL_ = positional[0] || 'http://127.0.0.1:5601/';
const COOKIE = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--cookie='));
  return a ? a.replace('--cookie=', '') : null;
})();
if (COOKIE !== null && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  console.error('  请把 TOKEN 的赋值单独写成一行，不要和 node 命令挤在同一个简单命令里。');
  process.exit(1);
}
const PORT = 9900 + (process.pid % 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); code = 1; };
const head = (t) => { console.log('\n══════════════════════════════════════════════════════'); console.log(' ' + t); console.log('══════════════════════════════════════════════════════'); };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-int-'));
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
  const evalJs = async (expr, awaitPromise = true) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Log.enable');
  if (COOKIE) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  // ============================================================
  head('A. 侧栏菜单项');
  await send('Page.navigate', { url: URL_ });
  await sleep(7000);

  const menu = await evalJs(`(() => {
    const entry = document.getElementById('crMenuEntry');
    const menuUl = document.querySelector('.layout__sidebar ul.el-menu');
    const native = menuUl ? [...menuUl.querySelectorAll(':scope > div > a > li.el-menu-item')] : [];
    const pick = (li) => {
      if (!li) return null;
      const cs = getComputedStyle(li); const r = li.getBoundingClientRect();
      const title = li.querySelector('.menu-title');
      const ico = li.querySelector('.menu-icon');
      const cst = title ? getComputedStyle(title) : null;
      return { text: li.textContent.trim().slice(0,20), h: Math.round(r.height), padding: cs.padding,
               fontSize: cs.fontSize, color: cs.color,
               titleCls: title ? title.className : null,
               titleDisplay: cst ? cst.display : null,
               titleFontSize: cst ? cst.fontSize : null,
               iconCls: ico ? ico.className : null,
               iconW: ico ? getComputedStyle(ico).width : null };
    };
    return {
      entryExists: !!entry,
      entryHtml: entry ? entry.innerHTML.replace(/\\s+/g,' ').slice(0, 260) : null,
      ours: entry ? pick(entry.querySelector('li.el-menu-item')) : null,
      natives: native.map(pick),
    };
  })()`);
  console.log(JSON.stringify(menu, null, 2));

  if (menu.entryExists) ok('侧栏出现了「课程资源管理」菜单项'); else bad('侧栏没有菜单项');
  // 拿「未选中」的原生项当基准：首页是选中态，颜色本来就是主色，比它没意义
  const nat = (menu.natives || []).find((n) => n && n.text !== '首页') || (menu.natives || [])[0];
  if (nat && menu.ours) {
    const same = ['h', 'padding', 'fontSize', 'color'].filter((k) => String(nat[k]) !== String(menu.ours[k]));
    if (!same.length) ok(`计算样式与原生菜单项「${nat.text}」完全一致（高/内边距/字号/颜色）`);
    else bad('与原生菜单项不一致的项: ' + same.map((k) => `${k}(${menu.ours[k]} vs ${nat[k]})`).join(', '));
    if (/menu-title/.test(menu.ours.titleCls || '')) ok('文字包在 .menu-title 里（折叠时才会被正确隐藏）');
    else bad('文字没有包在 .menu-title 里，折叠侧栏时会露出来');
    if (/i-svg:/.test(menu.ours.iconCls || '')) ok('图标用的是应用自带的 i-svg 体系');
    else bad('图标没有用 i-svg 体系，会和其它菜单项不一致');
    if (String(menu.ours.iconW) === String(nat.iconW)) ok(`图标尺寸与原生一致（${menu.ours.iconW}）`);
    else bad(`图标尺寸不一致：我们 ${menu.ours.iconW} vs 原生 ${nat.iconW}`);
  }

  // ============================================================
  head('A2. 侧栏图标（每一项都要有，且风格一致）');
  const icons = await evalJs(`(() => {
    const sb = document.querySelector('.layout__sidebar');
    const rows = [];
    sb.querySelectorAll('.el-menu-item, .el-sub-menu__title').forEach(item => {
      const ico = item.querySelector('.menu-icon');
      const title = item.querySelector('.menu-title');
      if (!ico || !title) return;
      const cs = getComputedStyle(ico);
      const mask = cs.maskImage || cs.webkitMaskImage || '';
      const bg = cs.backgroundImage || '';
      rows.push({
        name: title.textContent.trim(),
        cls: String(ico.className).replace(/data-v-\w+/g, '').trim(),
        kind: (mask && mask !== 'none') ? 'mask(单色)' : ((bg && bg !== 'none') ? 'bg(彩色)' : '缺失'),
        w: cs.width,
      });
    });
    return rows;
  })()`);
  console.log(JSON.stringify(icons, null, 2));
  const dead = icons.filter((r) => r.kind === '缺失');
  const colored = icons.filter((r) => r.kind === 'bg(彩色)');
  if (!dead.length) ok(`每个菜单项都有图标（共 ${icons.length} 项）`);
  else bad('这些菜单项没有图标: ' + dead.map((d) => d.name).join('、'));
  if (!colored.length) ok('全部是单色（mask）图标，风格一致');
  else bad('这些是彩色图标，和旁边的单色图标不搭: ' + colored.map((c) => c.name + '(' + c.cls + ')').join('、'));

  // ============================================================
  head('B. 点击菜单项 → 路由 + 渲染');
  const clicked = await evalJs(`(async () => {
    const link = document.querySelector('#crMenuEntry a');
    if (!link) return { error: '没有链接' };
    link.click();
    await new Promise(r => setTimeout(r, 2500));
    const host = document.querySelector('.app-main .cr-host');
    return {
      hash: location.hash,
      hostExists: !!host,
      hostParent: host ? host.parentNode.className : null,
      cards: document.querySelectorAll('.cr-host #gridWrapper [data-id]').length,
      statCourses: (document.querySelector('.cr-host #statCourses')||{}).textContent,
      statFiles: (document.querySelector('.cr-host #statTotalFiles')||{}).textContent,
      // 菜单项里不该有角标（按需求去掉了）
      menuExtraNodes: (() => {
        const li = document.querySelector('#crMenuEntry .el-menu-item');
        if (!li) return null;
        return [...li.children].map(c => c.tagName + '.' + String(c.className).slice(0, 30));
      })(),
      menuActive: (document.querySelector('#crMenuEntry .el-menu-item')||{classList:{contains:()=>null}}).classList.contains('is-active'),
      portals: {
        dock: !!document.querySelector('body .cr-portal > .dock'),
        preview: !!document.querySelector('body .cr-portal > #previewModal'),
        upload: !!document.querySelector('body .cr-portal > #uploadModal'),
        toast: !!document.querySelector('body .cr-portal > #toastRoot'),
      },
      // 浮层默认必须是隐藏的：关不掉的弹窗是最扎眼的问题，单独断言
      // 注意：弹窗不是靠 display:none 隐藏的 —— .overlay.is-hidden 是
      // 「display:flex !important; opacity:0; pointer-events:none」，
      // 故意留着 display 让透明度过渡能跑。所以要按「实际不可见」判，不能只看 display。
      overlayHidden: ['#previewModal', '#uploadModal', '.dock'].map(s => {
        const e = document.querySelector(s);
        if (!e) return s + '=missing';
        const cs = getComputedStyle(e);
        const hidden = cs.display === 'none'
          || (parseFloat(cs.opacity) === 0 && cs.pointerEvents === 'none');
        return s + '=' + (hidden ? 'hidden'
          : 'VISIBLE(display=' + cs.display + ' opacity=' + cs.opacity + ' pe=' + cs.pointerEvents + ')');
      }),
    };
  })()`);
  console.log(JSON.stringify(clicked, null, 2));

  if (clicked.hash === '#/course-resources') ok('路由跳到了 #/course-resources'); else bad('路由是 ' + clicked.hash);
  if (clicked.hostExists && clicked.hostParent === 'app-main') ok('页面挂进了 .app-main');
  else bad('页面没有挂进 .app-main（parent=' + clicked.hostParent + '）');
  if (clicked.cards > 0) ok(`渲染出 ${clicked.cards} 条资料`); else bad('没有渲染出任何资料');
  if (clicked.menuActive) ok('菜单项进入选中态'); else bad('菜单项没有选中态');
  // 菜单项只该有「图标 + 文字」两个子节点，不该有多余的角标
  const extra = (clicked.menuExtraNodes || []).filter((n) => !/menu-icon|menu-title/.test(n));
  if (!extra.length) ok('菜单项只有图标 + 文字，没有多余角标');
  else bad('菜单项里有多余节点: ' + extra.join(', '));
  if (clicked.portals.dock && clicked.portals.preview && clicked.portals.upload && clicked.portals.toast)
    ok('浮层（批量舱/两个弹窗/toast）挂在 document.body 下');
  else bad('浮层没有全部挂到 body: ' + JSON.stringify(clicked.portals));
  // 浮层默认必须真的隐藏。这里曾经出过问题：.cr-scope 加在浮层根上，
  // 而后代选择器匹配不到根自身，导致「.cr-scope .overlay.is-hidden」不命中，
  // 弹窗和批量舱关不掉、一直浮在页面上。
  const notHidden = (clicked.overlayHidden || []).filter((x) => !/=(hidden|missing)$/.test(x));
  if (!notHidden.length) ok('浮层默认都是 display:none（关得掉）');
  else bad('浮层没有隐藏: ' + notHidden.join(', '));

  // ============================================================
  head('C. 渲染进度（定位是哪个子渲染器没跑）');
  const prog = await evalJs(`(() => {
    const q = (s) => document.querySelector('.cr-host ' + s);
    const host = document.querySelector('.cr-host');
    return {
      hostCls: host ? host.className : null,
      // mount() 抛异常时会把错误直接摊到宿主里，这里把文案带出来
      hostText: host ? host.textContent.trim().replace(/\\s+/g, ' ').slice(0, 1400) : null,
      // 每个子渲染器的 DOM 产物，逐个看谁没跑
      pills: (q('#categoryTabs') || {}).children ? q('#categoryTabs').children.length : null,
      courseOptions: (q('#courseSelect') || {}).options ? q('#courseSelect').options.length : null,
      semesterCards: (q('#semesterCardGrid') || {}).children ? q('#semesterCardGrid').children.length : null,
      statCourses: (q('#statCourses') || {}).textContent,
      semesterHint: (q('#semesterHint') || {}).textContent,
      gridChildren: (q('#gridWrapper') || {}).children ? q('#gridWrapper').children.length : null,
      resultCount: (q('#resultCountBadge') || {}).textContent,
      // 浮层是挂到 body 上的，逐个看是否真的进去了、以及内部关键节点在不在
      bodyChildren: [...document.body.children].map(n => n.tagName + '#' + (n.id || '') + '.' + String(n.className).slice(0, 24)),
      previewClose: !!document.querySelector('body > #previewModal #previewClose'),
      dockDelete: !!document.querySelector('body > .dock #dockDelete'),
      uploadClose: !!document.querySelector('body > #uploadModal #uploadClose'),
    };
  })()`);
  console.log(JSON.stringify(prog, null, 2));
  if (prog.pills) ok('renderCategoryPills 跑了（胶囊 ' + prog.pills + ' 个）');
  else bad('renderCategoryPills 没跑 —— 说明 renderAll 之前就中断了（bind / switchView 抛异常）');
  if (prog.semesterCards) ok('renderSemesterCards 跑了（学期卡 ' + prog.semesterCards + ' 张）');
  else bad('renderSemesterCards 没跑');
  if (prog.statCourses && prog.statCourses !== '--') ok('renderStats 跑了（已归档课程=' + prog.statCourses + '）');
  else bad('renderStats 没跑');

  // ============================================================
  head('C2. 学期时间轴：箭头只在滚得动时才出现');
  // 课程优先导航：学期卡在资料区里，未选课程时整块是隐藏的（尺寸为 0，测不出滚动）。
  // 所以先点开一门课程，把资料区露出来再测。
  await evalJs(`(async () => {
    const g = document.querySelector('#courseCardGrid');
    if (!g) return;
    const cards = Array.from(g.children);
    const target = cards.filter((c) => /CS-401/.test(c.textContent))[0] || cards[0];
    if (target) target.click();
    await new Promise((r) => setTimeout(r, 700));
  })()`);
  const sem = await evalJs(`(async () => {
    const q = (s) => document.querySelector('.cr-host ' + s);
    const g = q('#semesterCardGrid');
    const prev = q('#semScrollPrev'), next = q('#semScrollNext');
    if (!g || !prev || !next) return { error: '元素缺失' };
    const vis = (b) => getComputedStyle(b).display;
    const out = {
      cards: g.children.length,
      scrollable: g.scrollWidth - g.clientWidth,
      arrowWhenFits: vis(prev),
    };
    // 造出溢出，看箭头是否出现、滚不滚得动
    const tpl = g.children[0] ? g.children[0].outerHTML : '';
    for (let i = 0; i < 8; i++) g.insertAdjacentHTML('beforeend', tpl);
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 300));
    out.scrollableAfter = g.scrollWidth - g.clientWidth;
    out.arrowWhenOverflow = vis(prev);
    const before = g.scrollLeft;
    next.click();
    await new Promise(r => setTimeout(r, 900));
    out.movedBy = Math.round(g.scrollLeft - before);
    out.backToStart = (() => { prev.click(); return null; })();
    await new Promise(r => setTimeout(r, 900));
    out.afterBack = Math.round(g.scrollLeft);
    return out;
  })()`);
  console.log(JSON.stringify(sem, null, 2));
  if (sem.error) bad('学期时间轴元素缺失: ' + sem.error);
  else {
    // 没有溢出时箭头必须隐藏 —— 否则就是一对点了没反应的死按钮
    if (sem.scrollable <= 1 && sem.arrowWhenFits === 'none') ok('内容装得下时，左右箭头已隐藏（不留死按钮）');
    else bad(`装得下却仍显示箭头（可滚动量=${sem.scrollable}, display=${sem.arrowWhenFits}）`);
    if (sem.scrollableAfter > 1 && sem.arrowWhenOverflow !== 'none') ok('内容溢出时箭头出现（可滚动量 ' + sem.scrollableAfter + 'px）');
    else bad(`溢出后箭头没出现（可滚动量=${sem.scrollableAfter}, display=${sem.arrowWhenOverflow}）`);
    if (sem.movedBy > 0) ok(`点右箭头真的滚动了 ${sem.movedBy}px（按卡片宽度算步长）`);
    else bad('点右箭头没有滚动');
    if (sem.afterBack === 0) ok('点左箭头滚回起点');
    else bad('点左箭头没回到起点（scrollLeft=' + sem.afterBack + '）');
  }

  // ============================================================
  head('D. 数据来源（对照接口原始返回）');
  // 复位到「全部课程」：C2 选了某门课，这一段要对照的是**全部**条目。
  await evalJs(`(async () => {
    const b = document.querySelector('#backToCoursesBtn');
    if (b) b.click();
    await new Promise((r) => setTimeout(r, 600));
  })()`);
  const truth = await evalJs(`(async () => {
    const g = async (u) => (await (await fetch(u, { credentials: 'same-origin' })).json());
    const courses = await g('/api/v1/course/list');
    let apiItems = 0, scenes = 0, sections = 0;
    for (const c of (courses.data || [])) {
      const s = await g('/api/v1/course/content-summary?courseId=' + c.id);
      const d = s.data || {};
      const sc = (d.scenes && d.scenes.scenes) || [];
      const st = d.structure || [];
      scenes += sc.length;
      st.forEach(ch => { sections += (ch.children || []).length; });
      apiItems += sc.length + st.length
                + (d.example && d.example.html ? 1 : 0)
                + ((d.learningPath && (d.learningPath.nodes || []).length) ? 1 : 0)
                + ((d.knowledgeGraphs && d.knowledgeGraphs.length) ? 1 : 0) + 1;
    }
    return { courseCount: (courses.data || []).length, apiItems, scenes, sections,
             domItems: document.querySelectorAll('.cr-host #gridWrapper [data-id]').length,
             domRows: document.querySelectorAll('.cr-host #tableBody tr[data-id]').length };
  })()`);
  console.log(JSON.stringify(truth, null, 2));
  if (truth.apiItems === truth.domItems) ok(`接口推导条目数 = 页面渲染条目数 = ${truth.apiItems}（不是内置假数据）`);
  else bad(`不一致：接口推导 ${truth.apiItems} vs 页面渲染 ${truth.domItems}`);

  // ============================================================
  head('E. 离开页面 → 清理');
  const away = await evalJs(`(async () => {
    const link = [...document.querySelectorAll('.layout__sidebar a[href]')]
      .find(a => /course-management/.test(a.getAttribute('href') || ''));
    if (link) link.click();
    await new Promise(r => setTimeout(r, 2500));
    return {
      hash: location.hash,
      hostExists: !!document.querySelector('.cr-host'),
      leftovers: {
        dock: !!document.querySelector('.dock'),
        preview: !!document.querySelector('#previewModal'),
        upload: !!document.querySelector('#uploadModal'),
        toast: !!document.querySelector('#toastRoot'),
        portalWraps: document.querySelectorAll('body > .cr-portal').length,
      },
      appMainText: (document.querySelector('.app-main')||{}).textContent.trim().replace(/\\s+/g,' ').slice(0, 70),
      menuActive: (document.querySelector('#crMenuEntry .el-menu-item')||{classList:{contains:()=>null}}).classList.contains('is-active'),
    };
  })()`);
  console.log(JSON.stringify(away, null, 2));
  if (!away.hostExists) ok('宿主节点已移除'); else bad('宿主节点还留在 DOM 里');
  const leaked = Object.entries(away.leftovers).filter(([, v]) => v).map(([k]) => k);
  if (!leaked.length) ok('浮层全部清理干净，无残留'); else bad('有残留: ' + leaked.join(', '));
  if (!away.menuActive) ok('离开后菜单项取消选中态'); else bad('离开后菜单项仍是选中态');
  if (/课程编码|课程列表|课程名称/.test(away.appMainText || '')) ok('课程列表页正常渲染（原有页面没被破坏）');

  // ============================================================
  head('F. 整页刷新直达 #/course-resources');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: '' });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(500);
  await send('Page.navigate', { url: URL_ + '#/course-resources' });
  await sleep(8000);
  const direct = await evalJs(`(() => ({
    hash: location.hash,
    hostExists: !!document.querySelector('.cr-host'),
    cards: document.querySelectorAll('.cr-host #gridWrapper [data-id]').length,
    menuCount: document.querySelectorAll('#crMenuEntry').length,
    appMainText: (document.querySelector('.app-main')||{}).textContent.trim().replace(/\\s+/g,' ').slice(0, 60),
  }))()`);
  console.log(JSON.stringify(direct, null, 2));
  if (direct.hash === '#/course-resources' && direct.hostExists) ok('刷新直达正常，没有被 404 兜底吃掉');
  else bad('刷新直达失败: hash=' + direct.hash + ' host=' + direct.hostExists);
  if (direct.menuCount === 1) ok('菜单项只注入了一份（幂等）'); else bad(`菜单项注入了 ${direct.menuCount} 份`);

  // ============================================================
  head('G. 控制台 / 外链 / 图标');
  const net = events.filter((e) => e.method === 'Network.responseReceived');
  // 只算真正的网络请求：data: / blob: 是内联资源，不是外链（上一版把它们误判成外部请求了）
  const ext = net.filter((e) => {
    const u = e.params.response.url;
    if (/^(data|blob|about):/.test(u)) return false;
    return !/^https?:\/\/(127\.0\.0\.1|localhost):\d+\//.test(u);
  });
  // 注意：Vue 会把生命周期钩子里的异常 catch 掉再 console.error，
  // 这种情况**不会**产生 Runtime.exceptionThrown，只看它就会漏报。
  // 必须同时收 Runtime.consoleAPICalled。
  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown'
    || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'));
  const iconInfo = await evalJs(`(() => {
    const all = [...document.querySelectorAll('iconify-icon')];
    return { total: all.length, rendered: all.filter(e => e.shadowRoot || e.querySelector('svg')).length,
             preloaded: (window.IconifyPreload ? (Array.isArray(window.IconifyPreload) ? window.IconifyPreload : [window.IconifyPreload]) : []).length };
  })()`);
  console.log('  请求总数:', net.length, ' 外部请求:', ext.length);
  console.log('  图标:', JSON.stringify(iconInfo));
  if (!ext.length) ok('无外部请求（没有 CDN 依赖）'); else bad('有外部请求: ' + ext.slice(0,3).map(e=>e.params.response.url).join(', '));
  if (iconInfo.total > 0 && iconInfo.rendered === iconInfo.total) ok(`图标全部渲染 ${iconInfo.rendered}/${iconInfo.total}`);
  else bad(`图标渲染不全 ${iconInfo.rendered}/${iconInfo.total}`);
  if (!errs.length) ok('控制台 0 错误');
  else {
    bad(`控制台有 ${errs.length} 条错误`);
    errs.slice(0, 6).forEach((e) => {
      const txt = e.params.exceptionDetails?.exception?.description
        || e.params.entry?.text
        || (e.params.args || []).map((a) => a.value || a.description || '').join(' ');
      console.log('      ·', String(txt).replace(/\n/g, ' ').slice(0, 260));
    });
  }

  // ============================================================
  head('H. 原有页面未受影响');
  await send('Page.navigate', { url: URL_ });
  await sleep(7000);
  const home = await evalJs(`(() => ({
    hash: location.hash,
    appMainText: (document.querySelector('.app-main')||{}).textContent.trim().replace(/\\s+/g,' ').slice(0, 70),
    themeLinkLast: (() => { const l = document.getElementById('ui-theme-override');
      return l ? (l.parentNode.lastElementChild === l) : null; })(),
    crScopedLeak: [...document.querySelectorAll('.app-main .cr-scope, .app-main .cr-page')].length,
    badgeGone: !document.getElementById('crMenuBadge'),
  }))()`);
  console.log(JSON.stringify(home, null, 2));
  if (/下午好|访问趋势|最近动态|访客数/.test(home.appMainText || '')) ok('首页正常渲染');
  else bad('首页渲染异常: ' + home.appMainText);
  if (home.themeLinkLast) ok('ui-theme.css 仍然排在 head 末尾（主题层没被打乱）');
  else bad('ui-theme.css 不在 head 末尾了，主题可能失效');
  if (!home.crScopedLeak) ok('首页里没有我们的作用域残留'); else bad('首页里出现了 .cr-scope/.cr-page 残留');
  if (home.badgeGone) ok('侧栏没有残留的角标节点');
  else bad('侧栏还有残留的角标节点');

  console.log('\n══════════════════════════════════════════════════════');
  console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：有失败项 ✗');
  console.log('══════════════════════════════════════════════════════');

  ws.close(); proc.kill();
  process.exit(code);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
