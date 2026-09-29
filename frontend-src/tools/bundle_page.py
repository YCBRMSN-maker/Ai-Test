#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把预览稿（teacher-dist-redesign）合成为一个可挂载的模块，供真实教师端使用。

预览稿是「独立整页」：自带一套复刻的侧栏 + 顶栏，靠 DOMContentLoaded 自己启动。
并入真实应用时要变成「可挂载」：
  · 去掉复刻外壳（真实应用自己提供）
  · 页面标记变成一段模板字符串，mount(host) 时注入
  · 浮层（批量舱 / 两个弹窗 / toast）挂到 document.body ——
    因为 .app-main 是 overflow:auto 的滚动容器，而且路由切换会挂 animate.css 类，
    一旦哪个祖先带上 transform 就会把 position:fixed 变成相对它定位。
    挂到 body 上就永远是相对视口。
  · $ 与 $$ 改成跨「宿主 + 浮层」查找

每一步替换都断言必须命中 —— 预览稿改了而这里没跟着改的话，
宁可报错退出，也不要静默产出一个坏掉的包。

用法：
  python tools/bundle_page.py
"""

import io
import os
import re
import sys

SRC_HTML = 'teacher-dist-redesign/_resource-vault.html'
SRC_JS = 'teacher-dist-redesign/js/resource-vault.js'
OUT_JS = 'teacher-dist/js/course-resources.js'


def read(p):
    return io.open(p, encoding='utf-8').read()


def extract_balanced(html, start_marker, tag='div'):
    """从 start_marker 所在的开标签开始，按标签配平截出整块。"""
    i = html.find(start_marker)
    if i < 0:
        raise SystemExit('✗ 找不到起始标记: %s' % start_marker)
    open_re = re.compile(r'<%s\b' % tag, re.I)
    close_re = re.compile(r'</%s>' % tag, re.I)
    depth = 0
    pos = i
    while pos < len(html):
        o = open_re.search(html, pos)
        c = close_re.search(html, pos)
        if c is None:
            raise SystemExit('✗ %s 的标签没有配平' % start_marker)
        if o is not None and o.start() < c.start():
            depth += 1
            pos = o.end()
        else:
            depth -= 1
            pos = c.end()
            if depth == 0:
                return html[i:pos]
    raise SystemExit('✗ %s 的标签没有配平' % start_marker)


def dedent(block):
    """去掉每行公共缩进，并剥掉首尾空行。"""
    lines = block.split('\n')
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    indents = [len(l) - len(l.lstrip()) for l in lines if l.strip()]
    cut = min(indents) if indents else 0
    return '\n'.join(l[cut:] if l.strip() else '' for l in lines)


def main():
    html = read(SRC_HTML)
    js = read(SRC_JS)

    # ---------- 1. 抽页面片段 ----------
    content = dedent(extract_balanced(html, '<main class="content">', 'main'))
    dock = dedent(extract_balanced(html, '<div class="dock" id="batchDock">'))
    preview_modal = dedent(extract_balanced(html, '<div class="overlay is-hidden" id="previewModal">'))
    upload_modal = dedent(extract_balanced(html, '<div class="overlay is-hidden" id="uploadModal">'))
    export_modal = dedent(extract_balanced(html, '<div class="overlay is-hidden" id="exportModal">'))
    toast = '<div class="toast-root" id="toastRoot"></div>'

    for name, blk in [('content', content), ('dock', dock),
                      ('previewModal', preview_modal), ('uploadModal', upload_modal),
                      ('exportModal', export_modal)]:
        if not blk.strip():
            raise SystemExit('✗ 抽出来的 %s 是空的' % name)

    # ---------- 2. 改 JS ----------
    orig = js

    # 2.1 头部注释
    old_head = """/* ===========================================================================
   课程资源管理页 · 交互逻辑

   纯原生 JS，无框架依赖（预览稿）。数据为演示用内存数据集，
   接后端时把 resources 换成接口返回即可。
--------------------------------------------------------------------------- */
(function () {
  'use strict';
"""
    new_head = """/* ===========================================================================
   课程资源管理页 · 交互逻辑（并入教师端的可挂载版本）

   本文件由 tools/bundle_page.py 从预览稿自动生成，**不要手改**。
   改预览稿（teacher-dist-redesign/）后重新跑：
       python tools/bundle_page.py

   与预览稿的差别只有「怎么挂上去」：
     · 复刻的侧栏 / 顶栏整块去掉 —— 真实应用自己提供外壳；
     · 页面标记收进 PAGE_HTML，由 mount(host) 注入；
     · 浮层（批量舱 / 弹窗 / toast）挂到 document.body，避免被 .app-main 的
       滚动容器或路由切换时的 transform 影响 position:fixed 的参照系；
     · $ / $$ 改成跨「宿主 + 浮层」查找；
     · 不再监听 DOMContentLoaded，改为对外暴露 window.CourseResources.mount/unmount。

   数据依旧全部来自真实接口，不内置任何演示数据。
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  /* 页面主体标记：由 mount() 注入宿主。 */
  var PAGE_HTML = [
%s
  ].join('\\n');

  /* 浮层标记：挂到 document.body，避开 .app-main 的滚动/动画上下文。 */
  var PORTAL_HTML = [
%s
  ].join('\\n');
"""
    if old_head not in js:
        raise SystemExit('✗ JS 头部注释没匹配上，预览稿可能改过')
    body_html = '\n'.join("    '%s'," % l.replace('\\', '\\\\').replace("'", "\\'")
                          for l in content.split('\n'))
    portal_html = '\n'.join("    '%s'," % l.replace('\\', '\\\\').replace("'", "\\'")
                            for l in (dock + '\n' + preview_modal + '\n' + upload_modal + '\n' + export_modal + '\n' + toast).split('\n'))
    js = js.replace(old_head, new_head % (body_html, portal_html), 1)

    # 2.2 $ 改成跨根查找
    old_dollar = "  var $ = function (id) { return document.getElementById(id); };"
    new_dollar = """  /* 查找根：宿主（页面主体）+ 各浮层。
     浮层挂在 document.body 上，所以不能只在宿主里找。 */
  var ROOTS = [];
  var $ = function (id) {
    for (var i = 0; i < ROOTS.length; i++) {
      var r = ROOTS[i];
      // ⚠️ 根节点自身也要比一次。querySelector 只找**后代**，元素永远匹配不到自己；
      // 而 #batchDock / #previewModal / #uploadModal 这三个浮层容器本身就是 ROOTS 的成员，
      // 漏了这一步的话 $('previewModal') 会恒为 null，
      // 然后调用方在 .addEventListener 上炸掉，报错行号还跟真正的原因对不上。
      if (r.id === id) return r;
      var el = r.querySelector('[id="' + id + '"]');
      if (el) return el;
    }
    if (window.__CR_DEBUG_LOOKUP) {
      console.warn('[course-resources] 找不到 #' + id + '（ROOTS=' + ROOTS.length + '）');
    }
    return null;
  };
  var $$ = function (sel) {
    var out = [];
    for (var i = 0; i < ROOTS.length; i++) {
      var r = ROOTS[i];
      if (r.matches && r.matches(sel)) out.push(r);   // 同理：根自身也要算上
      out = out.concat(Array.prototype.slice.call(r.querySelectorAll(sel)));
    }
    return out;
  };"""
    if old_dollar not in js:
        raise SystemExit('✗ $ helper 没匹配上')
    js = js.replace(old_dollar, new_dollar, 1)

    # 2.3 两处 querySelectorAll 改成 $$（跨根）
    reps = [
        ("Array.prototype.forEach.call(document.querySelectorAll('#viewSeg button'), function (b) {",
         "$$('#viewSeg button').forEach(function (b) {"),
        ("Array.prototype.forEach.call(document.querySelectorAll('[data-id=\"' + id + '\"]'), function (el) {",
         "$$('[data-id=\"' + id + '\"]').forEach(function (el) {"),
    ]
    for old, new in reps:
        if old not in js:
            raise SystemExit('✗ 没匹配上: %s' % old[:60])
        js = js.replace(old, new, 1)

    # 2.4 keydown 监听器抽成具名函数（匿名监听器摘不掉，每挂载一次就多留一个）
    old_key = """    // 快捷键 ⌘K / Ctrl+K 聚焦搜索
    window.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('globalSearch').focus();
      }
      if (e.key === 'Escape') {
        if (!$('previewModal').classList.contains('is-hidden')) closePreview();
        else if (!$('uploadModal').classList.contains('is-hidden')) closeUpload();
      }
    });
  }"""
    new_key = """    // 快捷键 ⌘K / Ctrl+K 聚焦搜索
    window.addEventListener('keydown', onKeydown);
  }

  /* 抽成具名函数，unmount 时才摘得掉 —— 匿名监听器挂上去就再也摘不掉，
     每次进出这个页面都会多留一个，而且里面的 $ 会指向已被移除的节点。 */
  function onKeydown(e) {
    if (!mounted) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      var s = $('globalSearch');
      if (s) s.focus();
    }
    if (e.key === 'Escape') {
      var pv = $('previewModal');
      var up = $('uploadModal');
      if (pv && !pv.classList.contains('is-hidden')) closePreview();
      else if (up && !up.classList.contains('is-hidden')) closeUpload();
    }
  }"""
    if old_key not in js:
        raise SystemExit('✗ keydown 监听块没匹配上')
    js = js.replace(old_key, new_key, 1)

    # 2.5 侧栏角标：页面算完真实条目数后广播出去，由 boot 脚本写进侧栏
    old_stat = """      if (it.category !== 'doc' && it.category !== 'md') sceneTotal++;
    });"""
    new_stat = """      if (it.category !== 'doc' && it.category !== 'md') sceneTotal++;
    });"""
    if old_stat not in js:
        raise SystemExit('✗ renderStats 的锚点没匹配上')
    js = js.replace(old_stat, new_stat, 1)

    # 2.6 启动方式：DOMContentLoaded → mount/unmount
    old_boot = """  /* ---------------- 启动 ---------------- */

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    switchView('grid');
    // 先渲染空壳，再拉真实数据；拉不到就显示明确的空态/错误态，绝不用假数据兜底
    renderAll();
    loadRealData();
  });
})();"""
    new_boot = """  /* ---------------- 对外接口 ---------------- */

  /* 浮层挂在 document.body：.app-main 是 overflow:auto 的滚动容器，
     且路由切换会给它挂 animate.css 的类。只要某个祖先带上 transform，
     position:fixed 就会改成相对那个祖先定位，批量舱和弹窗会跑偏。
     挂到 body 下就永远相对视口。 */
  var mounted = false;
  var portalNodes = [];

  function buildPortals() {
    var tmp = document.createElement('div');
    tmp.innerHTML = PORTAL_HTML;
    var inner = Array.prototype.slice.call(tmp.children);
    portalNodes = [];
    inner.forEach(function (n) {
      /* 每个浮层外面再包一层 .cr-scope，**不要**把 .cr-scope 直接加在浮层根上。
         因为样式是 `.cr-scope X` 这种后代选择器形式，而后代选择器匹配不到根自身：
         如果浮层根自己就是 .cr-scope，那么 `.cr-scope .overlay.is-hidden`
         永远不会命中 —— 表现就是弹窗和批量舱关不掉，一直浮在页面上。
         （和 $() 里「根节点自身也要比一次」是同一类坑。） */
      var wrap = document.createElement('div');
      wrap.className = 'cr-scope cr-portal';
      document.body.appendChild(wrap);
      wrap.appendChild(n);
      portalNodes.push(wrap);
      ROOTS.push(wrap);
    });
  }

  function mount(host) {
    if (mounted) return;
    mounted = true;

    host.classList.add('cr-page', 'cr-scope');
    host.innerHTML = PAGE_HTML;
    ROOTS.push(host);
    buildPortals();

    /* 半挂载是最难排查的失败形态：外壳渲染出来了、浮层也建好了，
       但一个子渲染器都没跑，页面上只有一片「--」，而且异常被 Vue 的
       生命周期钩子吞掉后控制台不一定会报。所以这里必须兜住并摊到页面上。 */
    try {
      bind();
      switchView('grid');
      // 先渲染空壳，再拉真实数据；拉不到就显示明确的空态/错误态，绝不用假数据兜底
      renderAll();
      loadRealData();
    } catch (e) {
      console.error('[course-resources] 初始化失败:', e);
      if (host) {
        host.innerHTML = '<div style="padding:24px 20px;color:#ff4d4f;'
          + 'font:400 14px/1.7 Inter,PingFang SC,Microsoft YaHei,system-ui">'
          + '<b>课程资源管理页初始化失败</b><br>'
          + (e && e.message ? e.message : String(e))
          + '<pre style="margin:10px 0 0;white-space:pre-wrap;font-size:12px;color:#909399">'
          + (e && e.stack ? String(e.stack) : '(无堆栈)')
          + '</pre></div>';
      }
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    window.removeEventListener('keydown', onKeydown);
    portalNodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    portalNodes = [];
    ROOTS = [];
    // 复位筛选状态：下次进来不该还停在上一轮的搜索词/筛选上
    state.semester = 'ALL';
    state.category = 'ALL';
    state.course = 'ALL';
    state.search = '';
    state.sort = 'newest';
    state.view = 'grid';
    state.selectedIds.clear();
    activePreviewItem = null;
    resources = [];
    courses = [];
  }

  window.CourseResources = { mount: mount, unmount: unmount };
})();"""
    if old_boot not in js:
        raise SystemExit('✗ 启动块没匹配上')
    js = js.replace(old_boot, new_boot, 1)

    if js == orig:
        raise SystemExit('✗ 什么都没改到')

    # ---------- 3. 写出 ----------
    d = os.path.dirname(OUT_JS)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    io.open(OUT_JS, 'w', encoding='utf-8', newline='\n').write(js)
    print('written: %s  (%d bytes, %d 行)' % (OUT_JS, len(js), js.count('\n') + 1))
    print('  页面标记 %d 行 / 浮层标记 %d 行' % (content.count('\n') + 1,
                                              (dock + preview_modal + upload_modal + toast).count('\n') + 1))


if __name__ == '__main__':
    main()
