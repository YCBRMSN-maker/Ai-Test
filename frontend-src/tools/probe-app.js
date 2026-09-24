#!/usr/bin/env node
/**
 * 摸清真实教师端（8326）的接入点，为「把课程资源管理页并进 teacher-dist」做准备。
 *
 * 要回答四个问题：
 *   1. 路由是 hash 还是 history？（决定菜单项该跳到哪里）
 *   2. 侧边栏菜单项长什么样（DOM 结构、属性、层级），新菜单项怎么插才不违和？
 *   3. 主内容区是哪个容器？内容怎么被替换？
 *   4. 点击菜单项后 URL 和 DOM 怎么变？
 *
 * 用法：node tools/probe-app.js [--cookie=pbl_session=xxx] [--url=...]
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

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-app-'));
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

  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  });
  const send = (method, params) => new Promise((resolve, reject) => { const i = ++id; pend.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  if (COOKIE && COOKIE !== true) {
    const [name, ...rest] = COOKIE.split('=');
    const res = await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    console.log('setCookie:', JSON.stringify(res));
  }

  await send('Page.navigate', { url: URL_ });
  await sleep(6000);

  console.log('\n══════ 1. 路由模式 ══════');
  console.log(await evalJs(`JSON.stringify({
    href: location.href,
    hash: location.hash,
    pathname: location.pathname,
    search: location.search,
  }, null, 2)`));

  console.log('\n══════ 2. 侧边栏菜单项 ══════');
  const menu = await evalJs(`(() => {
    // 找侧边栏容器
    const sb = document.querySelector('.layout__sidebar, aside, .sidebar');
    if (!sb) return { error: '没找到侧边栏容器', candidates: [...document.querySelectorAll('aside,nav')].map(e=>e.className) };
    const items = [...sb.querySelectorAll('a, li, [class*=menu-item], [class*=menuItem]')]
      .filter(e => e.textContent.trim() && e.querySelectorAll('a,li').length === 0)
      .slice(0, 40)
      .map(e => ({
        tag: e.tagName,
        cls: e.className,
        href: e.getAttribute('href'),
        text: e.textContent.trim().slice(0, 30),
        // 完整 outerHTML：菜单项的标签结构必须逐字对齐（文字是不是包在 span.menu-title 里、
        // 有没有 icon 占位等），否则插进去的条目样式会和原生不一致
        html: e.outerHTML.slice(0, 500),
        path: (() => { let p=[], n=e; while(n && n!==sb){ p.unshift(n.tagName.toLowerCase()+(n.className?'.'+String(n.className).trim().split(/\\s+/).join('.'):'')); n=n.parentElement;} return p.join(' > '); })(),
      }));
    return { sidebarCls: sb.className, items, fullMenuHtml: sb.querySelector('ul.el-menu') ? sb.querySelector('ul.el-menu').outerHTML.replace(/data-v-[a-z0-9]+=""/g, '').replace(/\s+/g, ' ') : null };
  })()`);
  console.log(JSON.stringify(menu, null, 2));

  console.log('\n══════ 3. 主内容区 ══════');
  const main = await evalJs(`(() => {
    const cands = [...document.querySelectorAll('main, .layout__main, [class*=main], [class*=content], [class*=app-main]')]
      .filter(e => e.clientWidth > 400 && e.clientHeight > 200)
      .slice(0, 12)
      .map(e => ({ tag: e.tagName, cls: String(e.className).slice(0,80), w: e.clientWidth, h: e.clientHeight,
                   childCount: e.children.length,
                   firstChildCls: e.children[0] ? String(e.children[0].className).slice(0,80) : null,
                   sample: e.textContent.trim().replace(/\\s+/g,' ').slice(0,100) }));
    return cands;
  })()`);
  console.log(JSON.stringify(main, null, 2));

  console.log('\n══════ 4. 顶栏结构 ══════');
  const navbar = await evalJs(`(() => {
    const nb = document.querySelector('.navbar, header, [class*=navbar]');
    if (!nb) return { error: 'no navbar' };
    return { cls: String(nb.className), h: nb.clientHeight, text: nb.textContent.trim().replace(/\\s+/g,' ').slice(0,120),
             html: nb.outerHTML.slice(0, 1200) };
  })()`);
  console.log(JSON.stringify(navbar, null, 2));

  console.log('\n══════ 5. 点一个菜单项，看 URL 怎么变 ══════');
  const nav = await evalJs(`(async () => {
    const sb = document.querySelector('.layout__sidebar, aside, .sidebar');
    const links = [...sb.querySelectorAll('a')].filter(a => a.textContent.trim());
    const before = location.href;
    const target = links.find(a => /课程管理|课程列表/.test(a.textContent)) || links[2];
    const t = target ? target.textContent.trim() : null;
    if (target) target.click();
    await new Promise(r => setTimeout(r, 1500));
    return { clicked: t, before, after: location.href, hashAfter: location.hash };
  })()`);
  console.log(JSON.stringify(nav, null, 2));

  console.log('\n══════ 6. 全量路由表（若可从 app 实例拿到） ══════');
  const routes = await evalJs(`(() => {
    const app = document.querySelector('#app');
    const keys = Object.keys(app || {});
    // Vue 会把实例挂在 __vue_app__ 上
    const va = app && app.__vue_app__;
    if (!va) return { note: '没拿到 __vue_app__', appKeys: keys };
    const r = va.config.globalProperties.$router;
    if (!r) return { note: '没有 $router' };
    const opts = r.options && r.options.routes;
    return { mode: r.options && r.options.history && r.options.history.base !== undefined ? 'web' : 'unknown',
             routeCount: opts ? opts.length : 0,
             routes: opts ? opts.map(x => ({ path: x.path, name: x.name, children: (x.children||[]).map(c=>({path:c.path,name:c.name,meta:c.meta})) })) : [] };
  })()`);
  console.log(JSON.stringify(routes, null, 2));

  console.log('\n══════ 7. 侧栏图标体系（i-svg:*）══════');
  const icons = await evalJs(`(() => {
    // i-svg:* 的规则不在 dist CSS 文件里，看运行时到底是怎么解析的
    const probe = document.querySelector('.layout__sidebar .menu-icon');
    const cs = probe ? getComputedStyle(probe) : null;
    const info = probe ? {
      cls: probe.className,
      w: cs.width, h: cs.height, margin: cs.margin,
      backgroundImage: cs.backgroundImage.slice(0, 80),
      maskImage: (cs.maskImage || cs.webkitMaskImage || 'none').slice(0, 80),
      flexShrink: cs.flexShrink,
    } : null;

    // 从样式表里翻出所有 .i-svg:xxx 的类名
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch (e) { continue; }
      if (!rules) continue;
      for (const r of rules) {
        if (!r.selectorText) continue;
        // 注意：CSS 类名里的冒号必须转义，选择器文本实际是 .i-svg\:homepage
        const m = r.selectorText.match(/\\.i-svg\\\\?:[a-zA-Z0-9_-]+/g);
        if (m) m.forEach(x => names.add(x.replace(/^\\.i-svg\\\\?:/, '')));
      }
    }

    // 也看看有没有注入的 <style>
    const injected = [...document.querySelectorAll('style')].map(s => (s.textContent||'').length);
    return { probe: info, iconCount: names.size, icons: [...names].sort(), styleTagCount: injected.length };
  })()`);
  console.log(JSON.stringify(icons, null, 2));

  console.log('\n══════ 8. 图标集：单色（mask）vs 彩色（background） ══════');
  const sizes = await evalJs(`(() => {
    // 直接看计算值最可靠：规则可能是 mask 简写、可能在分组选择器里、
    // 也可能被别的规则覆盖，翻 cssText 容易漏。
    const names = new Set();
    for (const sheet of document.styleSheets) {
      let rs; try { rs = sheet.cssRules; } catch (e) { continue; }
      if (!rs) continue;
      for (const r of rs) {
        if (!r.selectorText) continue;
        (r.selectorText.match(/\\.i-svg\\\\?:[a-zA-Z0-9_-]+/g) || [])
          .forEach(x => names.add(x.replace(/^\\.i-svg\\\\?:/, '')));
      }
    }
    const sb = document.querySelector('.layout__sidebar ul.el-menu') || document.body;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0';
    sb.appendChild(probe);
    const mono = [], color = [], dead = [];
    [...names].sort().forEach(n => {
      const d = document.createElement('div');
      d.className = 'i-svg:' + n;
      probe.appendChild(d);
      const cs = getComputedStyle(d);
      const mask = (cs.maskImage || cs.webkitMaskImage || '');
      const bg = cs.backgroundImage || '';
      const hasMask = mask && mask !== 'none';
      const hasBg = bg && bg !== 'none';
      if (hasMask && !hasBg) mono.push(n);
      else if (hasBg) color.push(n);
      else dead.push(n);      // 规则在、但既没 mask 也没背景 → 渲染不出来
      d.remove();
    });
    probe.remove();
    // 顺带把单色图标的完整写法抓出来，我们要照抄这套 mask 技术
    let sample = null;
    for (const sheet of document.styleSheets) {
      let rs; try { rs = sheet.cssRules; } catch (e) { continue; }
      if (!rs) continue;
      for (const r of rs) {
        if (r.selectorText && r.selectorText.indexOf('i-svg') >= 0 && r.selectorText.indexOf('homepage') >= 0) {
          sample = { sel: r.selectorText, css: r.style.cssText };
          break;
        }
      }
      if (sample) break;
    }
    return { total: names.size, mono, color, dead, sampleRule: sample };
  })()`);
  console.log(JSON.stringify(sizes, null, 2));

  ws.close(); proc.kill();
  process.exit(0);
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
