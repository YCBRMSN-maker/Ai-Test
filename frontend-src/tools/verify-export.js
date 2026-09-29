#!/usr/bin/env node
/**
 * 验证两件之前只是「声称」、没实测过的事：
 *   A. 导出按钮真的能落盘，且文件是可解析的真实数据（不是空壳）
 *   B. 未登录时页面给出明确提示，而不是空白或假数据
 *
 * 用法：
 *   node tools/verify-export.js <url> [--cookie=pbl_session=xxx] [--out=<目录>]
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
const URL_ = positional[0] || 'http://127.0.0.1:5600/_resource-vault.html';
const COOKIE = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--cookie='));
  return a ? a.replace('--cookie=', '') : null;
})();
// 见 check-vault.js 同名守卫：--cookie 为空时直接退出，避免把「未登录」误报成页面 bug。
if (COOKIE !== null && !/^[^=]+=.+/.test(COOKIE)) {
  console.error(`\n✗ --cookie 的值是空的：${JSON.stringify(COOKIE)}`);
  console.error('  请把 TOKEN 的赋值单独写成一行，不要和 node 命令挤在同一个简单命令里。');
  process.exit(1);
}
const OUT = (() => {
  const a = process.argv.slice(2).find((x) => x.startsWith('--out='));
  return a ? a.replace('--out=', '') : fs.mkdtempSync(path.join(os.tmpdir(), 'vault-dl-'));
})();
const PORT = 9333 + (process.pid % 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let code = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); code = 1; };

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-vexp-'));
  fs.mkdirSync(OUT, { recursive: true });
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
  const send = (method, params = {}) => {
    const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => {
      pend.set(i, { resolve, reject });
      setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 30000);
    });
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error');
    return r.result.value;
  };

  try {
    await send('Page.enable'); await send('Network.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    // 允许下载并指定落盘目录
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: OUT });

    if (COOKIE) {
      const [name, ...rest] = COOKIE.split('=');
      await send('Network.setCookie', { name, value: rest.join('='), domain: '127.0.0.1', path: '/' });
    }

    // ---------------- A. 导出 ----------------
    console.log('══════════════════════════════════════════════════════');
    console.log(' A. 导出功能（真的落盘 + 内容可解析）');
    console.log('══════════════════════════════════════════════════════');

    await send('Page.navigate', { url: URL_ });
    await sleep(5000);

    // 用「完整课程归档包」做样本：payload 最大，最能暴露问题
    const target = await evalJs(`(() => {
      const card = [...document.querySelectorAll('#gridWrapper [data-id]')]
        .find(a => /完整课程归档包/.test(a.textContent));
      if (!card) return null;
      const btn = card.querySelector('[data-download]');
      return { id: card.dataset.id, hasBtn: !!btn };
    })()`);

    if (!target || !target.hasBtn) {
      bad('找不到「完整课程归档包」的导出按钮');
    } else {
      console.log(`  样本条目: ${target.id}`);
      await evalJs(`document.querySelector('[data-id="${target.id}"] [data-download]').click()`);
      await sleep(2500);

      const files = fs.readdirSync(OUT).filter((f) => !f.endsWith('.crdownload'));
      if (!files.length) {
        bad(`导出后目录里没有文件（${OUT}）`);
      } else {
        files.forEach((f) => {
          const full = path.join(OUT, f);
          const size = fs.statSync(full).size;
          console.log(`  落盘文件: ${f}  (${(size / 1024).toFixed(1)} KB)`);
          if (size < 200) { bad('文件过小，可能是空壳'); return; }
          try {
            const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
            const keys = Object.keys(parsed);
            console.log(`  JSON 顶层键: ${keys.join(', ')}`);
            if (parsed.content && parsed.content.structure) {
              const ch = parsed.content.structure.length;
              const sc = ((parsed.content.scenes || {}).scenes || []).length;
              console.log(`  内含: ${ch} 章 / ${sc} 个场景`);
              if (ch && sc) ok('导出的是真实课程内容，可被 JSON.parse 解析');
              else bad('导出的课程内容为空');
            } else if (parsed.items) {
              console.log(`  内含 ${parsed.items.length} 条`);
              ok('导出的是真实条目集合，可被 JSON.parse 解析');
            } else {
              ok('导出文件可被 JSON.parse 解析');
            }
          } catch (e) {
            bad(`JSON 解析失败：${e.message}`);
          }
        });
      }
    }

    // ---------------- B. 未登录 ----------------
    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(' B. 未登录状态（应给明确提示，不得出现假数据）');
    console.log('══════════════════════════════════════════════════════');

    await send('Network.clearBrowserCookies');
    // ⚠️ 必须先跳到 about:blank 断开同文档导航。
    // URL_ 形如 http://host/#/course-resources，直接拼 ?loggedout=1 只会改 hash，
    // 那是**同文档导航，页面根本不重载** —— 上一轮登录态留下的角标会一直挂在那儿，
    // 看着像「未登录还显示 34」，其实是测试没真正重新加载。
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(600);
    await send('Page.navigate', { url: URL_ });
    await sleep(6000);

    const anon = await evalJs(`(() => {
      const txt = (s) => (document.querySelector(s)?.textContent || '').replace(/\\s+/g,' ').trim();
      return {
        hint: txt('#semesterHint'),
        gridText: txt('#gridWrapper'),
        cards: document.querySelectorAll('#gridWrapper [data-id]').length,
        files: txt('#statTotalFiles'),
        courses: txt('#statCourses'),
        // 侧栏不再有角标（按需求去掉了），这里断言它确实不在
        sidebarGone: !document.querySelector('#sidebarFileBadge') && !document.querySelector('#crMenuBadge'),
        navbarUser: txt('#navbarUser'),
        hash: location.hash,
        // 并入 teacher-dist 后，未登录会被应用自身的路由守卫拦到登录页 ——
        // 这时候整个 SPA 外壳都不渲染，我们的页面自然也挂不上。
        // 这是**更正确**的行为，不能当成失败。
        hasLoginForm: !!document.querySelector('input[type="password"]'),
      };
    })()`);

    console.log(`  提示语      : ${anon.hint}`);
    console.log(`  空态文案    : ${anon.gridText.slice(0, 60)}`);
    console.log(`  渲染卡片数  : ${anon.cards}`);
    console.log(`  统计卡      : 课程=${anon.courses} 资料=${anon.files}`);
    console.log(`  侧栏角标    : ${anon.sidebarGone ? '（已移除，符合预期）' : '仍然存在'}`);
    console.log(`  顶栏登录人  : ${anon.navbarUser}`);

    if (anon.cards !== 0) bad('未登录却渲染了卡片 —— 可能用了假数据兜底');
    else ok('未登录时不渲染任何卡片');

    const loginPage = /login/i.test(anon.hash) || anon.hasLoginForm;
    if (loginPage) {
      ok('未登录时被应用自身的路由守卫带到登录页（hash=' + anon.hash + '）');
    } else if (/登录/.test(anon.hint) || /登录/.test(anon.gridText)) {
      ok('给出了明确的登录提示');
    } else {
      bad('既没跳登录页，也没给出「请先登录」提示');
    }

    if (anon.sidebarGone) ok('侧栏没有角标节点（按需求已移除）');
    else bad('侧栏还残留着角标节点');

    console.log('');
    console.log('══════════════════════════════════════════════════════');
    console.log(code === 0 ? ' 结论：全部通过 ✓' : ' 结论：存在问题 ✗');
    console.log('══════════════════════════════════════════════════════');
  } catch (e) {
    console.error('FATAL:', e.message);
    code = 1;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(code);
})();
