#!/usr/bin/env node
/**
 * 教师端 UI 重构 —— 生效性探针 v2（CDP）
 *
 * 回答一个问题：ui-theme.css 是不是**真的**作用在了正式前端的页面上？
 * 不看截图（截图证明不了动效），只读计算样式 / CSSOM / 命中规则 / DOM 顺序。
 *
 * 四层证据：
 *   A. 加载层 —— 覆盖表是否真的排在 Vite 动态注入的组件样式之后
 *   B. 令牌层 —— CSS 变量是否落到 :root（含被行内样式抢占的 --el-color-primary）
 *   C. 计算层 —— 真实元素 + 瞬态组件模拟节点的 getComputedStyle 实际取值
 *   D. 命中层 —— CSS.getMatchedStylesForNode：到底是哪条规则赢了、来自哪个文件
 *
 * 用法：
 *   node tools/probe.js http://127.0.0.1:8326 --cookie=pbl_session=xxx \
 *        --routes=#/dashboard,#/analysis --explain=.el-button --active=.el-button--primary
 *
 * 可选：
 *   --explain=<选择器>   打印该元素全部命中规则（来源文件 + 声明值）
 *   --audit=<sel1;sel2>  逐个算出「每个属性哪条规则赢了」，标出被压掉的属性
 *   --active=<选择器>    派发真实鼠标事件读 :hover / :active 的计算样式
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const args = process.argv.slice(2);
const baseUrl = (args[0] || '').replace(/\/+$/, '');
const opt = Object.fromEntries(
  args.slice(1).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || true];
  })
);

if (!baseUrl) {
  console.error('usage: node tools/probe.js <baseUrl> --cookie=n=v [--routes=...] [--explain=sel] [--active=sel]');
  process.exit(1);
}

const WAIT = Number(opt.wait || 3800);
const W = Number(opt.w || 1600);
const H = Number(opt.h || 1000);
const PORT = 9700 + (process.pid % 200);
const COOKIE = opt.cookie ? String(opt.cookie) : null;
const ROUTES = String(opt.routes || '#/dashboard').split(',').map((s) => s.trim()).filter(Boolean);
const EXPLAIN_SEL = opt.explain ? String(opt.explain) : null;
const AUDIT_SEL = opt.audit ? String(opt.audit).split(';').map((s) => s.trim()).filter(Boolean) : null;
const ACTIVE_SEL = opt.active ? String(opt.active) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('Chrome/Edge not found');
}

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('devtools endpoint never became ready');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
}

/* ── 页面内探针 ─────────────────────────────────────────────────── */
const PROBE = String.raw`(() => {
  const out = {};
  const root = getComputedStyle(document.documentElement);
  const ident = (el) => el ? { tag: el.tagName.toLowerCase(), cls: el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '') } : null;
  const pick = (el, props) => {
    if (!el) return null;
    const s = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = s.getPropertyValue(p);
    return o;
  };

  /* A. 加载层 */
  const link = document.getElementById('ui-theme-override');
  const sheets = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
  const idx = link ? sheets.indexOf(link) : -1;
  let ruleCount = -1;
  try {
    const s = Array.from(document.styleSheets).find((x) => (x.href || '').includes('ui-theme.css'));
    ruleCount = s ? s.cssRules.length : -1;
  } catch (e) { ruleCount = -2; }

  out.load = {
    overrideLinkPresent: !!link,
    href: link ? link.getAttribute('href') : null,
    isLastInHead: !!link && document.head.lastElementChild === link,
    totalSheets: sheets.length,
    indexOfOverride: idx,
    sheetsAfterOverride: idx < 0 ? null : sheets.length - 1 - idx,
    uiThemeSheetLoaded: Array.from(document.styleSheets).filter((x) => (x.href || '').includes('ui-theme.css')).length,
    uiThemeRuleCount: ruleCount,
  };

  /* B. 令牌层 */
  out.tokens = {};
  for (const v of [
    '--el-color-primary', '--el-color-primary-light-1', '--el-color-primary-light-9',
    '--el-color-primary-dark-2', '--el-bg-color-page', '--el-text-color-primary',
    '--el-border-radius-base', '--ui-ease-out', '--ui-ease-in-out', '--ui-ease-drawer',
    '--ui-dur-press', '--ui-dur-fast', '--ui-dur-base', '--animate-duration',
  ]) out.tokens[v] = root.getPropertyValue(v).trim();

  /* C. 真实元素（逐个点名，避免 querySelector 命中意料之外的元素） */
  const T = [
    ['elButtonAny', '.el-button'],
    ['elButtonPrimary', '.el-button--primary'],
    ['elButtonPlain', '.el-button:not(.is-link):not(.is-text):not(.is-circle)'],
    ['antBtnAny', '.ant-btn'],
    ['antBtnPrimary', '.ant-btn-primary'],
    ['card', '.el-card, .ant-card'],
    ['tableTh', '.el-table th, .ant-table-thead th'],
    ['menuItemActive', '.el-menu-item.is-active'],
    ['menuRoot', '.el-menu'],
    ['pagerItem', '.el-pagination .el-pager li, .ant-pagination-item'],
  ];
  out.targets = {};
  for (const [name, sel] of T) {
    let el = null;
    try { el = document.querySelector(sel); } catch (e) { /* bad selector */ }
    out.targets[name] = el
      ? Object.assign(ident(el), { computed: pick(el, [
          'border-radius', 'background-color', 'color', 'font-weight',
          'transition-property', 'transition-duration', 'transition-timing-function',
          'box-shadow', 'transform']) })
      : { found: false, selector: sel };
  }

  /* C2. 仪表盘错峰（必须打在 .ant-col 包装层上） */
  const cols = Array.from(document.querySelectorAll('.dashboard-stats > .ant-col'));
  out.stagger = {
    statColCount: cols.length,
    delays: cols.map((c) => getComputedStyle(c).animationDelay),
    names: cols.map((c) => getComputedStyle(c).animationName),
    durations: cols.map((c) => getComputedStyle(c).animationDuration),
    fillModes: cols.map((c) => getComputedStyle(c).animationFillMode),
    finalOpacity: cols.map((c) => getComputedStyle(c).opacity),
  };

  /* C3. 瞬态组件：同 class 模拟节点，探真实级联 */
  const host = document.createElement('div');
  host.setAttribute('style', 'position:fixed;left:-9999px;top:0;width:0;height:0;');
  document.body.appendChild(host);
  const probeEl = (sel, html, props) => {
    const w = document.createElement('div');
    w.innerHTML = html;
    const n = w.firstElementChild;
    host.appendChild(n);
    const target = host.querySelector(sel);   // ← 从 host 里找，而不是从 n 里找
    const r = target ? pick(target, props) : { __notFound: sel };
    n.remove();
    return r;
  };

  out.transient = {
    dialogEnter: probeEl('.el-dialog',
      '<div class="dialog-fade-enter-from"><div class="el-dialog" style="width:100px;height:100px"></div></div>',
      ['transform', 'opacity', 'transform-origin']),
    dialogLeave: probeEl('.el-dialog',
      '<div class="dialog-fade-leave-to"><div class="el-dialog" style="width:100px;height:100px"></div></div>',
      ['transform', 'opacity']),
    dialogSettled: probeEl('.el-dialog',
      '<div class="el-overlay-dialog"><div class="el-dialog" style="width:100px;height:100px"></div></div>',
      ['transform', 'opacity', 'transform-origin']),
    drawer: probeEl('.el-drawer',
      '<div class="el-drawer" style="position:absolute;width:100px;height:100px"></div>',
      ['transition-property', 'transition-duration', 'transition-timing-function']),
    message: probeEl('.el-message',
      '<div class="el-message" style="position:absolute;width:100px;height:40px"></div>',
      ['transition-property', 'transition-duration', 'transition-timing-function']),
    popperLeft: probeEl('.el-zoom-in-top-enter-active',
      '<div class="el-zoom-in-top-enter-active" data-popper-placement="left-start" style="position:absolute;width:100px;height:50px"></div>',
      ['transform-origin']),
    popperRight: probeEl('.el-zoom-in-top-enter-active',
      '<div class="el-zoom-in-top-enter-active" data-popper-placement="right-start" style="position:absolute;width:100px;height:50px"></div>',
      ['transform-origin']),
    popperTop: probeEl('.el-zoom-in-top-enter-active',
      '<div class="el-zoom-in-top-enter-active" data-popper-placement="top-start" style="position:absolute;width:100px;height:50px"></div>',
      ['transform-origin']),
    zoomCenterLeave: probeEl('.el-zoom-in-center-leave-active',
      '<div class="el-zoom-in-center-leave-active" style="position:absolute;width:100px;height:50px"></div>',
      ['transform', 'opacity']),
    switchCore: probeEl('.el-switch__core',
      '<div class="el-switch"><div class="el-switch__core" style="width:40px;height:20px"></div></div>',
      ['transition-property', 'transition-duration', 'transition-timing-function']),
  };
  host.remove();

  out.page = { url: location.href, hash: location.hash, title: document.title };
  return out;
})()`;

/* ── 命中规则解释器（走 CDP，能拿到来源文件） ─────────────────────── */
async function explain(cdp, selector, sheetUrlById) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  if (!nodeId) return { selector, found: false };

  const res = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const interesting = /^(transition|transform|background-color|color|border-radius|box-shadow|animation)/;

  const dump = (rule) => {
    if (!rule || !rule.style) return null;
    const decls = {};
    for (const p of rule.style.cssProperties) {
      if (p.name && interesting.test(p.name) && !p.disabled) decls[p.name] = p.value + (p.important ? ' !important' : '');
    }
    return {
      selector: rule.selectorList ? rule.selectorList.text : null,
      source: sheetUrlById.get(rule.styleSheetId) || (rule.origin === 'user-agent' ? 'user-agent' : 'inline/unknown'),
      origin: rule.origin,
      decls,
    };
  };

  const matched = (res.matchedCSSRules || []).map((m) => {
    const d = dump(m.rule);
    if (!d) return null;
    d.matchedSelectors = m.matchingSelectors;
    return d;
  }).filter((d) => d && Object.keys(d.decls).length);

  const inline = res.inlineStyle ? dump({ style: res.inlineStyle, selectorList: { text: 'style=""' } }) : null;

  return {
    selector,
    found: true,
    inlineStyle: inline,
    matchedRules: matched,
    attributesStyle: null,
  };
}

/* ── 审计：对一批选择器，逐个算出「每个属性到底哪条规则赢了」 ────────
   动机：本次靠"恰好点到 .el-button"才发现一条 scoped 规则把覆盖层压掉了。
   要敢说"全都生效了"，就得把关键选择器全过一遍，而不是抽样。        */
const WATCH_PROPS = new Set([
  'transition', 'transition-property', 'transition-duration', 'transition-timing-function', 'transition-delay',
  'transform', 'border-radius', 'box-shadow', 'background-color', 'color', 'font-weight',
  'animation', 'animation-name', 'animation-duration', 'animation-delay', 'animation-fill-mode',
  'opacity', 'filter', 'outline', 'border-color',
]);

async function audit(cdp, selectors, sheetUrlById) {
  const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
  const out = [];

  for (const selector of selectors) {
    let nodeId = 0;
    try {
      const q = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      nodeId = q.nodeId;
    } catch (e) {
      out.push({ selector, error: e.message });
      continue;
    }
    if (!nodeId) { out.push({ selector, found: false }); continue; }

    let res;
    try {
      res = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
    } catch (e) {
      out.push({ selector, error: e.message });
      continue;
    }

    // 收集所有候选声明（含来源），再按 CSS 层叠规则挑赢家
    const candidates = new Map(); // prop -> [{origin, important, source, rule, value}]
    const addDecl = (rule, source, origin) => {
      if (!rule || !rule.style) return;
      for (const p of rule.style.cssProperties) {
        if (!p.name || p.disabled || !WATCH_PROPS.has(p.name)) continue;
        if (!candidates.has(p.name)) candidates.set(p.name, []);
        candidates.get(p.name).push({
          origin, important: !!p.important, source,
          rule: rule.selectorList ? rule.selectorList.text : null,
          value: p.value + (p.important ? ' !important' : ''),
        });
      }
    };

    for (const m of (res.matchedCSSRules || [])) {
      const src = sheetUrlById.get(m.rule.styleSheetId)
        || (m.rule.origin === 'user-agent' ? 'user-agent' : 'unknown');
      addDecl(m.rule, src, m.rule.origin);
    }
    // 行内样式：作者级、优先级最高（同 important 时压过选择器）
    if (res.inlineStyle) addDecl({ style: res.inlineStyle, selectorList: { text: 'style=""' } }, 'inline', 'regular');

    const shortName = (s) => (s === 'user-agent' || s === 'inline' || s === 'unknown') ? s : s.split('/').pop();

    // 层叠：先 author 优先于 user-agent；再 important 优先；最后按出现顺序（后者胜）
    const winners = {};
    const mine = {};   // ui-theme.css 有没有声明过这个属性
    for (const [prop, list] of candidates) {
      const authors = list.filter((d) => d.origin !== 'user-agent');
      const pool = authors.length ? authors : list;
      const importants = pool.filter((d) => d.important);
      const finalPool = importants.length ? importants : pool;
      const w = finalPool[finalPool.length - 1];
      winners[prop] = { value: w.value, source: shortName(w.source), rule: w.rule };
      mine[prop] = list.some((d) => String(d.source).includes('ui-theme.css'));
    }

    // 只报「我声明了、但赢家不是我」的属性 —— 这才是需要处理的问题
    const losses = {};
    for (const prop of Object.keys(winners)) {
      if (mine[prop] && !String(winners[prop].source).includes('ui-theme.css')) losses[prop] = winners[prop];
    }

    out.push({
      selector,
      found: true,
      propertiesDeclaredByTheme: Object.keys(mine).filter((p) => mine[p]),
      winners,
      losses,
      verdict: Object.keys(losses).length === 0 ? 'OK' : 'OVERRIDDEN',
    });
  }
  return out;
}

/* ── 主流程 ─────────────────────────────────────────────────────── */
(async () => {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`, 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let ws;
  try {
    await waitForDevtools();
    const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });

    const cdp = new CDP(ws);
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

    if (COOKIE) {
      const [name, ...rest] = COOKIE.split('=');
      await cdp.send('Network.setCookie', {
        name, value: rest.join('='), domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax',
      });
    }

    const report = { baseUrl, routes: {} };

    for (const route of ROUTES) {
      const full = `${baseUrl}/${route.startsWith('#') ? route : '#' + route}`;
      await cdp.send('Page.navigate', { url: full });
      await sleep(WAIT);

      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression: PROBE, returnByValue: true, awaitPromise: true,
      });
      const entry = exceptionDetails ? { error: JSON.stringify(exceptionDetails) } : (result.value || {});

      // styleSheetId → 来源 URL
      const sheetUrlById = new Map();
      for (const ev of cdp.events) {
        if (ev.method === 'CSS.styleSheetAdded' && ev.params && ev.params.header) {
          sheetUrlById.set(ev.params.header.styleSheetId, ev.params.header.sourceURL || '(inline <style>)');
        }
      }

      if (EXPLAIN_SEL) {
        try { entry.explain = await explain(cdp, EXPLAIN_SEL, sheetUrlById); }
        catch (e) { entry.explain = { selector: EXPLAIN_SEL, error: e.message }; }
      }

      if (AUDIT_SEL) {
        try { entry.audit = await audit(cdp, AUDIT_SEL, sheetUrlById); }
        catch (e) { entry.audit = { error: e.message }; }
      }

      if (ACTIVE_SEL) {
        try {
          const read = () => cdp.send('Runtime.evaluate', {
            expression: `(()=>{const e=document.querySelector(${JSON.stringify(ACTIVE_SEL)});if(!e)return null;const s=getComputedStyle(e);return {tag:e.tagName.toLowerCase(),cls:String(e.className),transform:s.transform,boxShadow:s.boxShadow,transitionDuration:s.transitionDuration,transitionTimingFunction:s.transitionTimingFunction}})()`,
            returnByValue: true,
          });

          // 用真实鼠标事件触发 :hover / :active —— 比 CSS.forcePseudoState 可靠，也更接近真人操作
          const rect = (await cdp.send('Runtime.evaluate', {
            expression: `(()=>{const e=document.querySelector(${JSON.stringify(ACTIVE_SEL)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height)}})()`,
            returnByValue: true,
          })).result.value;

          if (!rect) {
            entry.stateProbe = { selector: ACTIVE_SEL, note: 'selector not found on this route' };
          } else {
            const mouse = (type, extra = {}) => cdp.send('Input.dispatchMouseEvent', {
              type, x: rect.x, y: rect.y, button: 'left', clickCount: 1, ...extra,
            });

            const snapshot = async (label) => ({
              label,
              computed: (await read()).result.value,
            });

            const out = { selector: ACTIVE_SEL, hitPoint: rect, steps: [] };
            out.steps.push(await snapshot('normal'));

            await mouse('mouseMoved', { button: 'none', buttons: 0 });
            await sleep(450);
            out.steps.push(await snapshot('hover'));

            await mouse('mousePressed', { buttons: 1 });
            await sleep(450);                       // 等过渡跑完，读终值
            out.steps.push(await snapshot('active (mouse held)'));
            await mouse('mouseReleased', { buttons: 0 });
            await sleep(500);
            out.steps.push(await snapshot('after release'));
            await mouse('mouseMoved', { button: 'none', buttons: 0, x: 5, y: 5 });

            entry.stateProbe = out;
          }
        } catch (e) {
          entry.stateProbe = { selector: ACTIVE_SEL, error: e.message };
        }
      }

      report.routes[route] = entry;
    }

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
})();
