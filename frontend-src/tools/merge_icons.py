#!/usr/bin/env python3
"""把新增的 mdi 图标合并进本地离线图标包。

用法：python tools/merge_icons.py code-braces gesture-tap sitemap package-variant-closed

为什么要有这个脚本：项目禁外链，图标必须在构建期拉好、随页面本地发布。
运行时再去 api.iconify.design 取，内网/离线环境会直接丢图标。
"""
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "..", "teacher-dist-redesign", "js", "vendor", "iconify-icons-vault.js")


def load_bundle():
    with open(TARGET, encoding="utf-8") as fh:
        raw = fh.read()
    m = re.search(r"window\.IconifyPreload = (\{.*\});?\s*$", raw, re.S)
    if not m:
        sys.exit("解析失败：找不到 window.IconifyPreload = {...}")
    return json.loads(m.group(1))


def fetch(names):
    url = "https://api.iconify.design/mdi.json?icons=" + ",".join(names)
    # iconify 对无 UA 的请求直接 403，必须带上
    req = urllib.request.Request(url, headers={"User-Agent": "iconify-merge/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    wanted = sys.argv[1:]
    if not wanted:
        sys.exit(__doc__)

    bundle = load_bundle()
    have = set(bundle["icons"])
    missing = [n for n in wanted if n not in have]
    if not missing:
        print("全部已存在，无需拉取")
        return

    print("需要拉取 %d 个：%s" % (len(missing), ", ".join(missing)))
    data = fetch(missing)
    got = data.get("icons") or {}
    aliases = data.get("aliases") or {}

    added, alias_added = [], []
    for name, body in got.items():
        if name not in bundle["icons"]:
            bundle["icons"][name] = body
            added.append(name)
    for name, spec in aliases.items():
        bundle.setdefault("aliases", {})
        if name not in bundle["aliases"]:
            bundle["aliases"][name] = spec
            alias_added.append(name)

    # 别名指向的父图标必须也在包里，否则渲染时是空的
    bad = [a for a, s in bundle["aliases"].items() if s.get("parent") not in bundle["icons"]]
    if bad:
        sys.exit("别名父图标缺失：%s" % ", ".join(bad))

    not_found = [n for n in missing if n not in got and n not in aliases]
    if not_found:
        print("⚠ 未取到（可能名字不对）：%s" % ", ".join(not_found))

    out = (
        "// 课程资源管理页专用的本地图标包（离线，禁运行时 CDN）\n"
        "// 生成方式：学生端本地包 + 从 iconify CDN 拉取的 mdi 子集合并去重，不要手动修改。\n"
        "// 覆盖图标：%d 个\n" % len(bundle["icons"]) +
        "window.IconifyPreload = " + json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + ";\n"
    )
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(out)

    print("新增图标 %d 个：%s" % (len(added), ", ".join(added) or "-"))
    if alias_added:
        print("新增别名：%s" % ", ".join(alias_added))
    print("现共 %d 个图标，文件 %d 字节" % (len(bundle["icons"]), len(out.encode("utf-8"))))


if __name__ == "__main__":
    main()
