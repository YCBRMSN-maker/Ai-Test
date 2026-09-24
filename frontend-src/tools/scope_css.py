#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把预览页的 CSS 作用域化，好挂进真实教师端的 .app-main 里。

要做四件事：
  1. 丢掉「外壳」规则（侧栏 / 顶栏 / 面包屑）—— 真实应用自己提供外壳，
     预览页里那套 .sidebar/.topbar 是复刻品，并进去就是重复。
  2. 改写会污染全局的选择器（:root / * / html,body / body / iconify-icon /
     ::selection / ::-webkit-scrollbar*）。
  3. 其余全部加 .cr-scope 前缀 —— 这样既不会漏到应用里，
     也能靠 0,2,0 的权重压过应用的裸规则（应用里有裸的 `.grid{display:grid}`、`.table{display:table}`）。
  4. @media 要递归进去处理，@keyframes 内部原样保留。

用法：
  python tools/scope_css.py <输入.css> <输出.css> [--dump]
"""

import os
import re
import sys
import io

# 外壳相关：真实应用已经提供了这些，并进去只会重复/打架
SHELL_PATTERNS = [
    r'^\.app$',
    r'^\.shell$',
    r'^\.main$',
    r'^\.sidebar$',
    r'^\.sidebar-logo$',
    r'^\.logo-mark$',
    r'^\.sidebar-menu$',
    r'^\.menu-item',
    r'^\.menu-arrow$',
    r'^\.menu-badge$',
    r'^\.menu-',           # .menu-item 的各种修饰
    r'^\.topbar$',
    r'^\.crumb',
    r'^\.navbar-actions$',
    r'^\.navbar-user$',
]
SHELL_RE = [re.compile(p) for p in SHELL_PATTERNS]

PREFIX = '.cr-scope '


def is_shell(sel: str) -> bool:
    sel = sel.strip()
    # `.sidebar .icon-btn` 这类后代选择器也要一起丢掉
    if sel.startswith('.sidebar ') or sel.startswith('.topbar ') or sel.startswith('.app '):
        return True
    return any(r.search(sel) for r in SHELL_RE)


def split_top_level(css: str):
    """把 CSS 拆成顶层块。返回 [(kind, header, body)]，kind ∈ {'rule','at'}。"""
    blocks = []
    i = 0
    n = len(css)
    while i < n:
        # 跳过空白与注释
        while i < n and (css[i].isspace() or (css.startswith('/*', i) and (css.find('*/', i) + 2) > 0)):
            if css.startswith('/*', i):
                j = css.find('*/', i)
                if j < 0:
                    i = n
                    break
                i = j + 2
            else:
                i += 1
        if i >= n:
            break
        # 读 header 直到 '{'
        j = css.find('{', i)
        if j < 0:
            break
        header = css[i:j]
        # 配平花括号
        depth = 1
        k = j + 1
        while k < n and depth:
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        body = css[j + 1:k - 1]
        blocks.append((header, body))
        i = k
    return blocks


def scope_selector_list(sels: str):
    """把一组选择器逐个加前缀 / 改写。返回 (新选择器列表, 是否全丢)。"""
    out = []
    for raw in split_selectors(sels):
        s = raw.strip()
        if not s:
            continue
        # ---- 全局改写 ----
        if s == ':root':
            out.append('.cr-scope')
            continue
        if s == '*':
            out.append('.cr-scope *')
            continue
        if s in ('html, body', 'html,body'):
            continue  # 高度交给应用的 .app-main 管
        if s == 'html' or s == 'body':
            continue
        if s == 'iconify-icon':
            out.append('.cr-scope iconify-icon')
            continue
        if s.startswith('::'):
            # ::selection / ::-webkit-scrollbar* → 作用域内
            out.append('.cr-scope ' + s)
            continue
        if s.startswith('@'):
            out.append(s)
            continue
        # ---- 丢外壳 ----
        if is_shell(s):
            continue
        out.append(PREFIX + s)
    return out


def split_selectors(sels: str):
    """按逗号拆分选择器，但不动括号/引号里的逗号。"""
    parts, buf, depth = [], [], 0
    for ch in sels:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf))
    return parts


def process(css: str, depth=0, dump=None):
    out = []
    for header, body in split_top_level(css):
        h = header.strip()
        if h.startswith('@'):
            at = h.split(None, 1)[0].lower()
            if at in ('@media', '@supports', '@layer', '@container'):
                inner = process(body, depth + 1, dump)
                if inner.strip():
                    out.append('%s {\n%s\n}' % (header.rstrip(), indent(inner)))
                else:
                    if dump is not None:
                        dump.append('DROP(空) %s' % h)
            else:
                # @keyframes / @font-face 等：原样保留
                out.append('%s {%s}' % (header.rstrip(), body))
        else:
            # body 特殊处理：不能整块丢，否则字体/前景色全没了。
            # 拆成两条：字体/颜色等挂 .cr-scope（弹窗浮层也在作用域内，需要同样的字体），
            # 背景挂 .cr-page（只有页面块要底色，浮层自己有遮罩底色）。
            # margin / height 丢掉 —— 高度交给应用的 .app-main 管。
            if h.strip() == 'body':
                decls = [d.strip() for d in body.split(';') if d.strip()]
                scope_decls, page_decls = [], []
                for d in decls:
                    prop = d.split(':')[0].strip().lower()
                    if prop in ('margin', 'height'):
                        if dump is not None:
                            dump.append('DROP  body 的 %s' % d)
                        continue
                    if prop == 'background':
                        page_decls.append(d)
                    else:
                        scope_decls.append(d)
                if scope_decls:
                    out.append('.cr-scope { %s; }' % '; '.join(scope_decls))
                    if dump is not None:
                        dump.append('SPLIT body → .cr-scope { %s }' % '; '.join(scope_decls))
                if page_decls:
                    out.append('.cr-page { %s; }' % '; '.join(page_decls))
                    if dump is not None:
                        dump.append('SPLIT body → .cr-page { %s }' % '; '.join(page_decls))
                continue

            sels = scope_selector_list(h)
            if dump is not None:
                for s in split_selectors(h):
                    s = s.strip()
                    if not s:
                        continue
                    if is_shell(s) or s in ('html', 'body', 'html, body'):
                        dump.append('DROP  %s' % s)
                    else:
                        dump.append('KEEP  %-46s → %s' % (s, scope_selector_list(s)))
            if not sels:
                continue
            out.append('%s {%s}' % (', '.join(sels), body))
    return '\n\n'.join(out)


def indent(s):
    return '\n'.join(('  ' + line) if line.strip() else line for line in s.split('\n'))


ICON_BUNDLE = 'teacher-dist/js/vendor/iconify-icons-vault.js'

# 要补的侧栏图标：CSS 里的类名后缀 → (离线图标包里的名字, 用途说明)
#   · 应用菜单配置里「学情分析」「课程管理」都写的 icon: 'list'，但图标包里没有 list，
#     所以这两项一直是空的（应用自身的 bug，菜单配置引用了不存在的图标名）。
#   · 「课程资源管理」原本借用 i-svg:file，而 file 是**彩色**图标（黄文件夹），
#     和旁边 38 个单色线性图标风格不一致。
MENU_ICONS = [
    ('cr-analytics', 'chart-box',      '学情分析'),
    ('cr-course',    'book-education', '课程管理'),
    ('cr-resources', 'layers-outline', '课程资源管理'),
]


def load_icon_bodies(bundle_path):
    """从离线图标包里取出 mdi 图标的 body（一段 <path>）。"""
    import json
    raw = io.open(bundle_path, encoding='utf-8').read()
    m = re.search(r'window\.IconifyPreload\s*=\s*(\{.*\});?\s*$', raw, re.S)
    if not m:
        raise SystemExit('✗ 读不出图标包：%s' % bundle_path)
    data = json.loads(m.group(1))
    w = data.get('width', 24)
    h = data.get('height', 24)
    return data['icons'], w, h


def mask_url(body, w, h):
    """把图标 body 转成 mask-image 用的 data URI。

    编码只处理会破坏 data URI 的字符：< > # %
    **双引号必须换成单引号**：body 里是 fill="currentColor"，
    直接塞进 url("...") 会把 CSS 字符串提前闭合，整条声明被丢掉 ——
    表现是图标位置出现一个实心方块（背景色还在、mask 没了）。
    应用的图标规则用的也是单引号，这里保持一致。
    """
    body = body.replace('"', "'")
    svg = ("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 %d %d'>%s</svg>"
           % (w, h, body))
    svg = svg.replace('%', '%25').replace('<', '%3C').replace('>', '%3E').replace('#', '%23')
    return 'url("data:image/svg+xml;utf8,%s")' % svg


def menu_icon_css(bundle_path):
    """生成侧栏菜单图标的 CSS。读不出图标包就返回空串（不阻塞主流程）。"""
    if not os.path.exists(bundle_path):
        print('! 找不到图标包，跳过菜单图标生成：%s' % bundle_path)
        return ''
    icons, w, h = load_icon_bodies(bundle_path)
    sels, rules = [], []
    for suffix, icon_name, why in MENU_ICONS:
        if icon_name not in icons:
            raise SystemExit('✗ 图标包里没有 %s（%s 要用）' % (icon_name, why))
        sels.append('.layout__sidebar .i-svg\\:%s' % suffix)
        rules.append('.layout__sidebar .i-svg\\:%s { --cr-ico: %s; } /* %s ← mdi:%s */'
                     % (suffix, mask_url(icons[icon_name]['body'], w, h), why, icon_name))
    return """
/* --- 侧栏菜单图标：补齐应用缺的三个 -------------------------------------------

   应用的菜单图标是「CSS mask + currentColor」实现的单色图标，规则名形如
   `.i-svg\\:homepage`。下面用同一套技术补三个：

     · 「学情分析」「课程管理」：应用菜单配置里都写 icon: 'list'，
       但图标包里根本没有 list —— 这两项一直是空的（应用自身的 bug）。
     · 「课程资源管理」：原本借用 i-svg:file，而 file 是**彩色**图标（黄文件夹），
       和旁边那些单色线性图标风格不搭。

   选择器写成 `.layout__sidebar .i-svg\\:xxx`（权重 0,2,0），
   稳稳压过应用那边的单类名规则（0,1,0），不依赖样式表先后顺序。
   用 `.layout__sidebar` 而不是 `.el-menu-item` 打头：带子菜单的那一项
   （课程管理）的图标在 `.el-sub-menu__title` 里，不在 `.el-menu-item` 里。

   图形取自离线图标包（js/vendor/iconify-icons-vault.js），
   本段由 tools/scope_css.py 生成，不要手改。
--------------------------------------------------------------------------- */
%s {
  -webkit-mask-image: var(--cr-ico);
  mask-image: var(--cr-ico);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: 100%% 100%%;
  mask-size: 100%% 100%%;
  background-color: currentcolor;
}

%s
""" % (',\n'.join(sels), '\n'.join(rules))


# 刻意**不加** .cr-scope 前缀的部分：这些规则作用在应用外壳的侧栏上，
# 不在 .cr-scope 作用域内。全部以 #crMenuEntry 唯一 id 打头，不会外漏。
EXTRA = """
/* ===========================================================================
   以下刻意**不加** .cr-scope 前缀。

   原因：侧栏属于应用外壳。我们注入的菜单项长在 .layout__sidebar 里，
   根本不在 .cr-scope 作用域内，加了前缀反而失效。
   这些规则全部以 #crMenuEntry 这个唯一 id 打头，不会影响应用的其它部分。
--------------------------------------------------------------------------- */

/* 菜单项结构对齐原生：div.i-svg:xxx.menu-icon + span.menu-title.ml-1
   （原生那条 li 的 HTML 是直接从真实应用上抄下来的） */
#crMenuEntry .el-menu-item { position: relative; }
"""


def main():
    src, dst = sys.argv[1], sys.argv[2]
    dump_flag = '--dump' in sys.argv
    css = io.open(src, encoding='utf-8').read()
    dump = [] if dump_flag else None
    result = process(css, 0, dump)
    if dump_flag:
        print('\n'.join(dump))
        print('\n--- 以上为选择器改写计划 ---\n')
    header = (
        '/* ===========================================================================\n'
        '   课程资源管理页 · 样式（并入教师端 teacher-dist）\n\n'
        '   全部选择器都收在 .cr-scope 下，原因有两个：\n'
        '     1. 不外漏 —— 应用的全局样式表里没有 .cr-scope 前缀，互相不干扰；\n'
        '     2. 压得住 —— 应用里有裸规则 `.grid{display:grid}` / `.table{display:table}`，\n'
        '        单类名(0,1,0) 压不过 .cr-scope .grid(0,2,0)。\n\n'
        '   外壳（.sidebar / .topbar / .crumb）整块删掉了 —— 真实应用自己提供，\n'
        '   预览页里那套是复刻品，并进去就是重复。\n\n'
        '   本文件由 tools/scope_css.py 生成，不要手改；改预览稿后重新生成。\n'
        '--------------------------------------------------------------------------- */\n\n'
    )
    extra = EXTRA + menu_icon_css(ICON_BUNDLE)
    io.open(dst, 'w', encoding='utf-8', newline='\n').write(header + result + extra + '\n')
    print('written: %s  (%d bytes)' % (dst, len(header + result + extra)))


if __name__ == '__main__':
    main()
