# -*- coding: utf-8 -*-
"""补齐本地图标包：扫描源码里用到的 mdi 图标，把本地包里缺的从 iconify 拉回来合并。

背景：教师端离线运行（禁运行时 CDN），图标必须预先打进
`js/vendor/iconify-icons-vault.js`（window.IconifyPreload）。漏了哪个图标，
页面就会在运行时向 api.iconify.design 发请求 —— 离线/演示环境直接显示不出来。

用法：
  python tools/update_icons.py            # 只补齐缺失的
  python tools/update_icons.py --check    # 只检查，不写文件（缺则退出码 1）
"""
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'teacher-dist-redesign')
BUNDLES = [
    os.path.join(ROOT, 'teacher-dist-redesign', 'js', 'vendor', 'iconify-icons-vault.js'),
    os.path.join(ROOT, 'teacher-dist', 'js', 'vendor', 'iconify-icons-vault.js'),
]
API = 'https://api.iconify.design/mdi.json?icons='


def read(p):
    return io.open(p, encoding='utf-8').read()


def load_bundle(path):
    txt = read(path)
    m = re.search(r'window\.IconifyPreload\s*=\s*(\{.*\})\s*;?\s*$', txt, re.S)
    if not m:
        raise SystemExit('✗ 解析图标包失败: %s' % path)
    return txt[:m.start()], json.loads(m.group(1))


def used_icons():
    used = set()
    for dirpath, _d, files in os.walk(SRC_DIR):
        if 'vendor' in dirpath:
            continue
        for f in files:
            if f.endswith(('.html', '.js', '.css')):
                s = io.open(os.path.join(dirpath, f), encoding='utf-8', errors='ignore').read()
                used |= set(re.findall(r'mdi:([a-z0-9-]+)', s))
    return used


def fetch(names):
    got = {}
    names = sorted(names)
    for i in range(0, len(names), 20):            # 分批，避免 URL 过长
        batch = names[i:i + 20]
        url = API + ','.join(batch)
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
        got.update(data.get('icons') or {})
    return got


def main():
    check_only = '--check' in sys.argv
    prefix, data = load_bundle(BUNDLES[0])
    have = set((data.get('icons') or {}).keys()) | set((data.get('aliases') or {}).keys())
    used = used_icons()
    missing = sorted(used - have)
    print('包内 %d 个 / 源码用到 %d 个 / 缺失 %d 个' % (len(have), len(used), len(missing)))
    if not missing:
        print('✓ 图标包已完整，无需补齐')
        return 0
    for x in missing:
        print('  · mdi:' + x)
    if check_only:
        print('✗ 有缺失图标（--check 模式不写文件）')
        return 1

    print('从 iconify 拉取 %d 个图标…' % len(missing))
    got = fetch(missing)
    still = [x for x in missing if x not in got]
    if still:
        print('✗ 以下图标没拉到: %s' % ', '.join(still))
    data.setdefault('icons', {}).update(got)
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    out = prefix + 'window.IconifyPreload = ' + body + ';\n'
    for p in BUNDLES:
        d = os.path.dirname(p)
        if not os.path.isdir(d):
            continue
        io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
        print('  written: %s（共 %d 个图标）' % (p, len(data['icons'])))
    return 0


if __name__ == '__main__':
    sys.exit(main())
