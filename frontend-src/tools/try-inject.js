#!/usr/bin/env node
/**
 * 可行性验证：在没有 Vue 源码的前提下，能否在 dist 层把新页面接进真实应用？
 *
 * 只做注入、不落任何文件。要验证四件事：
 *   1. 能否拿到 app.__vue_app__.config.globalProperties.$router 并 addRoute
 *   2. 注册的组件能否把 DOM 挂进 .app-main（Vue3 的 render 不传 h，所以用 render:()=>null + mounted 挂兄弟节点）
 *   3. 侧栏能否插进一个和 Element-Plus 菜单项结构一致的条目
 *   4. 直达 #/course-resources（模拟刷新）会不会被 404 兜底吃掉
 *
 * 用法：node tools/try-inject.js [--cookie=pbl_session=xxx]
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
const URL_ = opt.url || 'http://127.0.0.1:8326/';
const COOKIE = opt.cookie || null;
if (COOKIE !== null && COOKIE !== true && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  process.exit(1);
}
const PORT = 9800 + (process.pid % 150);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 注入脚本：模拟最终 boot 脚本要做的事
// 注意：脚本必须可重复执行（真实 boot 会被 MutationObserver 反复触发），
// 所以侧栏注入要带「已存在就跳过」的守卫。
const INJECT = `(async () => {
  const log = [];
  const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__;
  if (!app) return { fatal: '拿不到 __vue_app__' };
  const router = app.config.globalProperties.$router;
  if (!router) return { fatal: '拿不到 $router' };
  log.push('router ok, has addRoute=' + (typeof router.addRoute));

  const originalHash = window.__CR_ORIG_HASH;

  if (!window.__CR_ROUTE_ADDED) {
    const Comp = {
      name: 'CourseResourcesProbe',
      render() { return null; },          // Vue3 的 render 不传 h；返回 null 渲染成注释占位
      mounted() {
        const host = document.createElement('div');
        host.className = 'cr-page';
        host.id = 'crProbeHost';
        host.textContent = '课程资源管理（探针占位）';
        this.$el.parentNode.appendChild(host);
        this._host = host;
        window.__CR_MOUNTED = (window.__CR_MOUNTED || 0) + 1;
        window.__CR_PARENT_CLS = this.$el.parentNode.className;
      },
      beforeUnmount() {
        window.__CR_UNMOUNTED = (window.__CR_UNMOUNTED || 0) + 1;
        if (this._host && this._host.parentNode) this._host.parentNode.removeChild(this._host);
      },
    };
    try {
      router.addRoute('/', { path: 'course-resources', name: 'CourseResources', component: Comp, meta: { title: '课程资源管理', icon: 'list' } });
      window.__CR_ROUTE_ADDED = true;
      log.push('addRoute ok');
    } catch (e) { log.push('addRoute 失败: ' + e.message); }
  } else {
    log.push('route 已注册过，跳过');
  }

  // 侧栏注入（幂等）
  const menu = document.querySelector('.layout__sidebar ul.el-menu');
  let sidebarInjected = false;
  if (menu && !menu.querySelector('.cr-menu-wrap')) {
    const wrap = document.createElement('div');
    wrap.className = 'cr-menu-wrap';
    wrap.innerHTML = '<a href="#/course-resources" class="cr-menu-link"><li class="el-menu-item submenu-title-noDropdown"><span>课程资源管理</span></li></a>';
    menu.appendChild(wrap);
    sidebarInjected = true;
  }

  // 模拟刷新直达：如果原始 hash 就是目标页，重新导航一次
  if (originalHash && originalHash.indexOf('course-resources') >= 0 && location.hash.indexOf('course-resources') < 0) {
    await router.replace('/course-resources');
    await new Promise(r => setTimeout(r, 800));
  }

  return { log, sidebarInjected, menuCls: menu ? menu.className : null,
           hashNow: location.hash, mounted: window.__CR_MOUNTED || 0, parentCls: window.__CR_PARENT_CLS };
})()`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-inj-'));
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

  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  if (COOKIE && COOKIE !== true) {
    const [name, ...rest] = COOKIE.split('=');
    await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
  }

  // 场景 A：先正常进首页，注入后**点侧栏链接**切过去
  console.log('══════ 场景 A：首页 → 点注入的侧栏菜单项 ══════');
  await send('Page.navigate', { url: URL_ });
  await sleep(6500);
  await evalJs(`window.__CR_ORIG_HASH = location.hash;`);
  console.log(JSON.stringify(await evalJs(INJECT), null, 2));

  const clicked = await evalJs(`(async () => {
    const link = document.querySelector('.cr-menu-link');
    if (!link) return { error: '侧栏没注入成功' };
    link.click();
    await new Promise(r => setTimeout(r, 1500));
    return { hash: location.hash, hostExists: !!document.querySelector('#crProbeHost'),
             hostParent: (document.querySelector('#crProbeHost')||{}).parentNode ? document.querySelector('#crProbeHost').parentNode.className : null };
  })()`);
  console.log('点击后：', JSON.stringify(clicked, null, 2));

  // 场景 A2：切走，看是否正常卸载、是否掉进 404
  const away = await evalJs(`(async () => {
    const links = [...document.querySelectorAll('.layout__sidebar a[href]')];
    const target = links.find(a => /course-management/.test(a.getAttribute('href') || ''));
    if (target) target.click();
    await new Promise(r => setTimeout(r, 1500));
    const main = document.querySelector('.app-main');
    return { hash: location.hash, hostExists: !!document.querySelector('#crProbeHost'),
             appMainText: main ? main.textContent.trim().replace(/\\s+/g,' ').slice(0,90) : null };
  })()`);
  console.log('切走后：', JSON.stringify(away, null, 2));

  // 场景 B：真正的整页刷新直达（先 about:blank 断开同文档导航）
  console.log('\n══════ 场景 B：整页刷新直达 #/course-resources ══════');
  // 关键：必须在文档开始执行时就记下原始 hash —— 这正是真实 boot 脚本的位置。
  // 上一版在 6.5s 后才记，那时路由器早已把 #/course-resources 重定向成 #/404 了。
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__CR_ORIG_HASH = location.hash;',
  });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(600);
  await send('Page.navigate', { url: URL_ + '#/course-resources' });
  await sleep(6500);
  console.log('文档开始时记录的原始 hash:', await evalJs('window.__CR_ORIG_HASH'));
  console.log('现在实际 hash:', await evalJs('location.hash'));
  console.log(JSON.stringify(await evalJs(INJECT), null, 2));
  await sleep(1000);
  console.log('刷新后状态：', JSON.stringify(await evalJs(`(() => {
    const main = document.querySelector('.app-main');
    return { hash: location.hash, hostExists: !!document.querySelector('#crProbeHost'),
             sidebarItemCount: document.querySelectorAll('.cr-menu-wrap').length,
             appMainText: main ? main.textContent.trim().replace(/\\s+/g,' ').slice(0,90) : null };
  })()`), null, 2));

  // 场景 C：侧栏菜单项视觉对比 + 面包屑是否跟着变
  console.log('\n══════ 场景 C：侧栏菜单项视觉 / 面包屑 ══════');
  console.log(JSON.stringify(await evalJs(`(() => {
    const menu = document.querySelector('.layout__sidebar ul.el-menu');
    const items = [...menu.querySelectorAll('li.el-menu-item')];
    return {
      items: items.map(li => {
        const cs = getComputedStyle(li); const r = li.getBoundingClientRect();
        return { text: li.textContent.trim().slice(0,20), h: Math.round(r.height),
                 padding: cs.padding, fontSize: cs.fontSize, color: cs.color };
      }),
      breadcrumb: (document.querySelector('.el-breadcrumb') || {}).textContent,
      crWrapCount: document.querySelectorAll('.cr-menu-wrap').length,
    };
  })()`), null, 2));

  const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
  console.log('\n══════ 控制台错误 ══════');
  console.log(errs.length ? errs.slice(0, 8).map((e) => (e.params.exceptionDetails?.exception?.description || e.params.entry?.text || '').slice(0, 250)).join('\n---\n') : '  (无)');

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
