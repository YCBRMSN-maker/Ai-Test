#!/usr/bin/env node
/**
 * 课程资源管理页 自检脚本（CDP）
 *
 * 一次性检查四件事：
 *   A 控制台报错 / 资源加载失败
 *   B 离线图标是否全部渲染出来（iconify-icon 的 shadowRoot 里有没有 <svg>）
 *   C 有没有请求外部 CDN（项目 nginx 禁止外链）
 *   D 关键交互是否真的改变了 DOM（筛选 / 视图切换 / 弹窗 / 勾选）
 *
 * 用法：node tools/check-vault.js <url>
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

const URL_ = (() => {
  const a = process.argv.slice(2).find((x) => !x.startsWith('--'));
  return a || 'http://127.0.0.1:5600/_resource-vault.html';
})();
const COOKIE = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--cookie='));
  return a ? a.replace('--cookie=', '') : null;
})();
// 传了 --cookie 但值是空的 —— 最常见的写法错误是：
//   TOK=xxx node tools/xxx.js --cookie="pbl_session=$TOK"
// 前缀赋值不参与同一简单命令的展开，$TOK 在这里是空串。
// 不拦住的话，工具会「安静地」以未登录状态跑完，
// 把「没登录」误报成页面 bug（0 张卡片、找不到 [data-check]）。
if (COOKIE !== null && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  console.error('  请把 TOKEN 的赋值单独写成一行，不要和 node 命令挤在同一个简单命令里。');
  process.exit(1);
}
const PORT = 9333 + (process.pid % 200);
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
    this.consoleErrors = [];
    this.failedRequests = [];
    this.allRequests = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        this.consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.consoleErrors.push(`[exception] ${d.exception?.description || d.text}`);
      }
      if (msg.method === 'Network.requestWillBeSent') {
        this.allRequests.push(msg.params.request.url);
      }
      if (msg.method === 'Network.loadingFailed') {
        this.failedRequests.push(`${msg.params.type} ${msg.params.errorText}`);
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

(async () => {
  const chrome = findChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-vault-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--window-size=1600,1100', 'about:blank',
  ], { stdio: 'ignore', detached: false });

  let ws;
  let code = 0;
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
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false,
    });

    // 会话 Cookie：cookie 按 host 作用域、不分端口，所以 8326 上登录拿到的
    // pbl_session 在 5600 一样会被带上（同站、SameSite=Lax 允许）。
    if (COOKIE) {
      const [name, ...rest] = COOKIE.split('=');
      await cdp.send('Network.setCookie', {
        name, value: rest.join('='), domain: '127.0.0.1', path: '/',
      });
      console.log(`  (已注入会话 Cookie: ${name})`);
    }

    await cdp.send('Page.navigate', { url: URL_ });
    await sleep(4000);

    const evalJs = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
      return r.result.value;
    };

    console.log('══════════════════════════════════════════════════════');
    console.log(' A. 控制台 / 资源');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  控制台 error 数 : ${cdp.consoleErrors.length}`);
    cdp.consoleErrors.slice(0, 12).forEach((e) => console.log(`    ✗ ${e.slice(0, 220)}`));
    console.log(`  加载失败数      : ${cdp.failedRequests.length}`);
    cdp.failedRequests.slice(0, 12).forEach((e) => console.log(`    ✗ ${e}`));

    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' B. 离线图标渲染');
    console.log('══════════════════════════════════════════════════════');
    const iconReport = await evalJs(`(() => {
      const nodes = [...document.querySelectorAll('iconify-icon')];
      const unrendered = [];
      let rendered = 0;
      for (const n of nodes) {
        const sr = n.shadowRoot;
        const hasSvg = sr && sr.querySelector('svg');
        if (hasSvg) rendered++;
        else unrendered.push(n.getAttribute('icon'));
      }
      // IconifyPreload 允许「单个集合对象」或「集合数组」两种写法，这里都要能数
      const raw = window.IconifyPreload;
      const cols = !raw ? [] : (Array.isArray(raw) ? raw : [raw]);
      const preload = cols.reduce((a, c) => a + Object.keys((c && c.icons) || {}).length, 0);
      const names = new Set(cols.flatMap((c) => Object.keys((c && c.icons) || {}).map((k) => c.prefix + ':' + k)));
      return { total: nodes.length, rendered, unrendered: [...new Set(unrendered)], preload, names: [...names] };
    })()`);
    console.log(`  <iconify-icon> 总数 : ${iconReport.total}`);
    console.log(`  已渲染出 svg        : ${iconReport.rendered}`);
    console.log(`  预加载图标数        : ${iconReport.preload}`);
    if (iconReport.unrendered.length) {
      console.log(`  ✗ 未渲染 (${iconReport.unrendered.length}):`);
      iconReport.unrendered.forEach((i) => console.log(`      ${i}`));
      code = 1;
    } else {
      console.log('  ✓ 全部图标均已渲染');
    }

    // 标记里用到、但离线包里没有的图标名 —— 这类会静默走 CDN
    const declared = await evalJs(`(() => {
      const html = document.documentElement.outerHTML;
      const names = [...html.matchAll(/icon="(mdi:[a-z0-9-]+)"/g)].map(m => m[1]);
      const raw = window.IconifyPreload;
      const cols = !raw ? [] : (Array.isArray(raw) ? raw : [raw]);
      const aliases = new Set(cols.flatMap(c => Object.keys((c && c.aliases) || {}).map(k => c.prefix + ':' + k)));
      const set = new Set([...cols.flatMap(c => Object.keys((c && c.icons) || {}).map(k => c.prefix + ':' + k)), ...aliases]);
      return { declared: [...new Set(names)], missing: [...new Set(names)].filter(n => !set.has(n)) };
    })()`);
    console.log(`  标记中引用图标数    : ${declared.declared.length}`);
    if (declared.missing.length) {
      console.log(`  ✗ 未包含在离线包内 (${declared.missing.length}): ${declared.missing.join(', ')}`);
      code = 1;
    } else {
      console.log('  ✓ 引用全部命中离线包');
    }

    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' C. 外链检查（项目禁止 CDN）');
    console.log('══════════════════════════════════════════════════════');
    const externals = [...new Set(cdp.allRequests.filter((u) => !u.startsWith('http://127.0.0.1:5600') && !u.startsWith('data:') && !u.startsWith('blob:')))];
    if (externals.length) {
      console.log(`  ✗ 发现外部请求 ${externals.length} 条：`);
      externals.forEach((u) => console.log(`      ${u.slice(0, 160)}`));
      code = 1;
    } else {
      console.log(`  ✓ 无外部请求（共 ${cdp.allRequests.length} 条请求，全部本地）`);
    }

    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' D. 交互自检');
    console.log('══════════════════════════════════════════════════════');
    const interact = await evalJs(`(() => {
      const out = [];
      const q = (s) => document.querySelector(s);
      const $$ = (s) => [...document.querySelectorAll(s)];
      const txt = (s) => (q(s)?.textContent || '').trim().replace(/\\s+/g, ' ');
      const hid = (s) => { const e = q(s); return e ? e.classList.contains('is-hidden') : null; };
      const opa = (s) => { const e = q(s); return e ? getComputedStyle(e).opacity : null; };

      // D0 初始渲染
      out.push({ step: '初始渲染', gridCards: $$('#gridWrapper [data-id]').length,
        tableRows: $$('#tableBody tr[data-id]').length,
        semCards: $$('#semesterCardGrid [data-sem]').length,
        pills: $$('#categoryTabs [data-cat]').length,
        resultCount: txt('#resultCountBadge') });

      // D1 分类筛选
      const pills = $$('#categoryTabs [data-cat]').filter(p => !p.classList.contains('is-on'));
      const before = $$('#gridWrapper [data-id]').length;
      if (pills.length) {
        pills[0].click();
        out.push({ step: '点击分类「' + pills[0].textContent.trim() + '」', before,
          after: $$('#gridWrapper [data-id]').length, resultCount: txt('#resultCountBadge'),
          activePill: (q('#categoryTabs .is-on') || {}).textContent?.trim() });
      } else out.push({ step: '分类筛选', error: '未找到未选中的分类按钮' });

      // D2 视图切换
      const listSeg = $$('#viewSeg [data-view]').find(s => s.dataset.view === 'list');
      const gridSeg = $$('#viewSeg [data-view]').find(s => s.dataset.view === 'grid');
      if (listSeg) {
        listSeg.click();
        out.push({ step: '切到清单视图', gridHidden: hid('#gridWrapper'), tableHidden: hid('#tableWrapper') });
        gridSeg.click();
        out.push({ step: '切回卡片视图', gridHidden: hid('#gridWrapper'), tableHidden: hid('#tableWrapper') });
      } else out.push({ step: '视图切换', error: '未找到视图按钮' });

      // D3 打开 / 关闭预览弹窗
      const pv = q('[data-preview]');
      if (pv) {
        pv.click();
        out.push({ step: '打开预览弹窗', modalHidden: hid('#previewModal'), opacity: opa('#previewModal'),
          badge: txt('#previewBadge'), title: txt('#previewTitle'), course: txt('#previewCourse') });
        q('#previewClose').click();
        out.push({ step: '关闭预览弹窗', modalHidden: hid('#previewModal') });
      } else out.push({ step: '预览弹窗', error: '未找到 [data-preview]' });

      // D4 上传弹窗
      q('#openUploadBtn').click();
      out.push({ step: '打开上传弹窗', modalHidden: hid('#uploadModal'), opacity: opa('#uploadModal') });
      q('#uploadClose').click();
      out.push({ step: '关闭上传弹窗', modalHidden: hid('#uploadModal') });

      // D5 勾选 -> 批量操作栏
      const cb = q('[data-check]');
      cb.click();
      out.push({ step: '勾选 1 份资料', dockHidden: hid('#batchDock'), dockOpacity: opa('#batchDock'),
        count: txt('#dockSelectedCount'), cardSel: $$('#gridWrapper .is-sel').length });
      q('#dockClear').click();
      out.push({ step: '取消选择', dockHidden: hid('#batchDock'), count: txt('#dockSelectedCount') });

      // D6 搜索（先重置，避免落在 D1 的筛选结果里导致误判）
      q('#resetBtn').click();
      const gs = q('#globalSearch');
      gs.value = '函数';
      gs.dispatchEvent(new Event('input', { bubbles: true }));
      out.push({ step: '重置后搜索「函数」', resultCount: txt('#resultCountBadge'),
        cards: $$('#gridWrapper [data-id]').length,
        firstTitle: (q('#gridWrapper [data-id] .card-title') || {}).textContent?.slice(0, 30) });
      gs.value = 'Zzz-不存在';
      gs.dispatchEvent(new Event('input', { bubbles: true }));
      out.push({ step: '搜索无结果时', resultCount: txt('#resultCountBadge'),
        emptyHidden: hid('#emptyView'), cards: $$('#gridWrapper [data-id]').length });
      q('#resetBtn').click();
      out.push({ step: '再次重置', resultCount: txt('#resultCountBadge'),
        cards: $$('#gridWrapper [data-id]').length, searchVal: q('#globalSearch').value,
        emptyHidden: hid('#emptyView') });

      return out;
    })()`);
    interact.forEach((r) => {
      if (r.error) { console.log(`  ✗ ${r.step}: ${r.error}`); code = 1; return; }
      const parts = Object.entries(r).filter(([k]) => k !== 'step').map(([k, v]) => `${k}=${v}`);
      console.log(`  · ${r.step}\n      ${parts.join('  ')}`);
    });

    // E. 动效是否真的落地（弹窗 / 批量栏 从隐藏态进入，要能稳定停在 opacity 1）
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' E. 动效落地（打开后 500ms 再测）');
    console.log('══════════════════════════════════════════════════════');
    const anim = await evalJs(`(async () => {
      const q = (s) => document.querySelector(s);
      const snap = (s) => { const e = q(s); if (!e) return null;
        const c = getComputedStyle(e); const r = e.getBoundingClientRect();
        return { opacity: c.opacity, transform: c.transform, transition: c.transitionDuration,
                 w: Math.round(r.width), h: Math.round(r.height), hidden: e.classList.contains('is-hidden') }; };
      const out = {};
      out.preview_closed = snap('#previewModal');
      q('[data-preview]').click();
      out.preview_at_0ms = snap('#previewModal');
      await new Promise(r => setTimeout(r, 500));
      out.preview_at_500ms = snap('#previewModal');
      q('#previewClose').click();
      await new Promise(r => setTimeout(r, 500));
      out.preview_after_close = snap('#previewModal');

      q('[data-check]').click();
      await new Promise(r => setTimeout(r, 500));
      out.dock_at_500ms = snap('#batchDock');
      q('#dockClear').click();
      await new Promise(r => setTimeout(r, 500));
      out.dock_after_clear = snap('#batchDock');
      return out;
    })()`);
    for (const [k, v] of Object.entries(anim)) {
      if (!v) { console.log(`  ✗ ${k}: 元素不存在`); code = 1; continue; }
      // 只在「稳定态」上判定：
      //   hidden=true  → 应当 opacity 0（隐藏）
      //   hidden=false → 应当 opacity 1（已落地），且尺寸不为 0
      // 带 _at_0ms 的是过渡起点，opacity 就该是 0，不参与判定。
      const isTransient = k.includes('_at_0ms');
      const bad = !isTransient && (
        (v.hidden && Number(v.opacity) > 0) ||
        (!v.hidden && (Number(v.opacity) < 1 || v.w === 0 || v.h === 0))
      );
      console.log(`  ${bad ? '✗' : '·'} ${k.padEnd(20)} opacity=${v.opacity} ${v.w}×${v.h} hidden=${v.hidden} ${bad ? '  ← 异常' : (isTransient ? '  （过渡起点，正常）' : '')}`);
      if (bad) code = 1;
    }

    // F. 数据来源真实性：确认页面上的数字确实是接口来的，而不是内置的
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' F. 数据来源（对照接口原始返回）');
    console.log('══════════════════════════════════════════════════════');
    const truth = await evalJs(`(async () => {
      const g = async (u) => {
        const r = await fetch(u, { credentials: 'same-origin' });
        const b = await r.json();
        return b && b.data !== undefined ? b.data : b;
      };
      const courses = await g('/api/v1/course/list');
      const out = { apiCourses: courses.length, apiItems: 0, apiScenes: 0, apiSections: 0, domItems: 0 };
      for (const c of courses) {
        const s = await g('/api/v1/course/content-summary?courseId=' + c.id);
        out.apiScenes += ((s.scenes && s.scenes.scenes) || []).length;
        out.apiSections += (s.structure || []).reduce((a, ch) => a + ((ch.children || []).length), 0);
        out.apiItems += ((s.scenes && s.scenes.scenes) || []).length
                      + (s.structure || []).length          // 每章一条「小节讲义」
                      + (s.example && s.example.html ? 1 : 0)
                      + ((s.learningPath && (s.learningPath.nodes || []).length) ? 1 : 0)
                      + ((s.knowledgeGraphs && s.knowledgeGraphs.length) ? 1 : 0)
                      + 1;                                   // 完整归档包
      }
      out.domItems = document.querySelectorAll('#gridWrapper [data-id]').length;
      out.statCourses = document.getElementById('statCourses')?.textContent;
      out.statFiles = document.getElementById('statTotalFiles')?.textContent;
      out.navbarUser = document.getElementById('navbarUser')?.textContent;
      return out;
    })()`);
    console.log(`  接口课程数          : ${truth.apiCourses}`);
    console.log(`  接口推导条目数      : ${truth.apiItems}`);
    console.log(`  页面实际渲染条目数  : ${truth.domItems}`);
    console.log(`  接口场景数          : ${truth.apiScenes}`);
    console.log(`  接口小节数          : ${truth.apiSections}`);
    console.log(`  顶栏显示登录人      : ${truth.navbarUser}`);
    if (truth.apiItems !== truth.domItems) {
      console.log(`  ✗ 页面条目数与接口推导不一致（${truth.domItems} vs ${truth.apiItems}）`);
      code = 1;
    } else {
      console.log('  ✓ 页面条目数与接口推导完全一致（不是内置假数据）');
    }
    if (truth.statCourses !== truth.apiCourses + ' 门') {
      console.log(`  ✗ 课程数展示不符：${truth.statCourses}`);
      code = 1;
    }
    if (truth.statFiles !== truth.domItems + ' 份') {
      console.log(`  ✗ 资料数展示不符：${truth.statFiles}`);
      code = 1;
    }

    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：存在问题 ✗');
    console.log('══════════════════════════════════════════════════════');
  } catch (err) {
    console.error('FATAL:', err.message);
    code = 1;
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(code);
})();
