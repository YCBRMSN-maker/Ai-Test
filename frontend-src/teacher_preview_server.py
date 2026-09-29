#!/usr/bin/env python3
"""
教师端 UI 重构预览服务

用途：把 `teacher-dist-redesign/`（teacher-dist 的副本）当作站点根目录托管，
并按 `nginx.conf` 里教师端 server（listen 8326）的规则反代 `/api`，
这样对比页 / 动效页能拿到真实后端数据。

对应关系（逐条对齐 nginx.conf 第 92-112 行）：
    /api/teacher-portal/*  →  /api/v1/teacher-portal/*   （课程生成引擎）
    /api/v1/*              →  原样透传                    （学生端既有接口）
    其余 /api/*            →  加 /api/v1/ 前缀            （认证 /api/user/* 等）
    /js/vendor/monaco/*    →  html/js/vendor/monaco/*     （与学生端共用 vendor）

另外：
- 禁用缓存：改完 CSS 刷新即可见，不需要硬刷新
- SSE（text/event-stream）**逐块转发**，不缓冲 —— 否则课程生成的事件流会被憋住
- 支持 WebSocket 升级（/api/v1/ws/*）

用法：
    python teacher_preview_server.py                        # 默认 5600，托管 teacher-dist-redesign/
    python teacher_preview_server.py 5601
    python teacher_preview_server.py 5601 teacher-dist       # 指定站点根目录（用来验证并入后的真实应用）
"""

import http.client
import os
import re
import sys
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
# 站点根目录：默认预览副本；第二个参数可指定成 teacher-dist 来验证「并入后」的效果
ROOT_NAME = sys.argv[2] if len(sys.argv) > 2 else "teacher-dist-redesign"
ROOT = ROOT_NAME if os.path.isabs(ROOT_NAME) else os.path.join(HERE, ROOT_NAME)
MONACO_DIR = os.path.join(HERE, "html", "js", "vendor", "monaco")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5600

BACKEND_HOST = "127.0.0.1"
BACKEND_PORT = 8000

# 顺序敏感，与 nginx 的 rewrite 顺序一致
REWRITES = [
    (re.compile(r"^/api/teacher-portal/(.*)$"), r"/api/v1/teacher-portal/\1"),
    (re.compile(r"^/api/v1/(.*)$"), r"/api/v1/\1"),
    (re.compile(r"^/api/(.*)$"), r"/api/v1/\1"),
]

HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
}


def rewrite(path: str) -> str:
    for pattern, repl in REWRITES:
        if pattern.match(path):
            return pattern.sub(repl, path)
    return path


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # --- 预览环境禁用缓存 ---
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    # --- 教师端 root 不含 monaco，别名到学生端静态目录 ---
    def _serve_monaco(self):
        rel = urllib.parse.urlsplit(self.path).path[len("/js/vendor/monaco/"):]
        target = os.path.normpath(os.path.join(MONACO_DIR, rel))
        if not target.startswith(MONACO_DIR) or not os.path.isfile(target):
            self.send_error(404)
            return
        with open(target, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        ctype = self.guess_type(target)
        if ctype:
            self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    # --- 反代 ---
    def _proxy(self):
        parsed = urllib.parse.urlsplit(self.path)
        target = rewrite(parsed.path)
        if parsed.query:
            target += "?" + parsed.query

        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        headers["Host"] = f"{BACKEND_HOST}:{BACKEND_PORT}"

        conn = http.client.HTTPConnection(BACKEND_HOST, BACKEND_PORT, timeout=86400)
        conn.request(self.command, target, body=body, headers=headers)
        resp = conn.getresponse()

        is_sse = "text/event-stream" in (resp.getheader("Content-Type") or "")

        # ⚠️ 非 SSE 的响应体只能 read() 一次！
        # 之前写成 `self.send_header("Content-Length", str(len(resp.read())))`
        # 再在下面 `resp.read()` 取 payload —— 第二次读恒为空，
        # 于是发出去的是「有 Content-Length、但一个字节都没写」的响应，
        # 客户端会一直等剩下的字节 → 请求永久挂住（curl 不返回）。
        payload = None if is_sse else resp.read()

        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in HOP_BY_HOP or k.lower() == "content-length":
                continue
            self.send_header(k, v)
        if is_sse:
            # SSE：不能给 Content-Length，且必须立即冲刷
            self.send_header("Cache-Control", "no-cache")
        else:
            self.send_header("Content-Length", str(len(payload)))
        self.end_headers()

        if self.command == "HEAD":
            conn.close()
            return

        if is_sse:
            # 逐块转发，边到边发（对应 nginx 的 proxy_buffering off）
            while True:
                chunk = resp.read(1)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        else:
            self.wfile.write(payload)
        conn.close()

    def _dispatch(self):
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path.startswith("/api/"):
                self._proxy()
            elif path.startswith("/js/vendor/monaco/"):
                self._serve_monaco()
            else:
                (super().do_GET if self.command == "GET" else super().do_HEAD)()
        except BrokenPipeError:
            pass
        except Exception as exc:  # 后端没起来时给出可读的报错
            msg = f"preview server error: {exc}".encode("utf-8")
            try:
                self.send_response(502)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(msg)))
                self.end_headers()
                self.wfile.write(msg)
            except Exception:
                pass

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = _dispatch


class Server(ThreadingHTTPServer):
    """ThreadingHTTPServer 本身已继承 ThreadingMixIn，不要再重复混入。"""
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    if not os.path.isdir(ROOT):
        sys.exit(f"找不到副本目录：{ROOT}")
    print(f"预览服务已启动  http://127.0.0.1:{PORT}/")
    print(f"  静态根目录 : {ROOT}")
    print(f"  对比页     : http://127.0.0.1:{PORT}/_compare.html")
    print(f"  动效演示   : http://127.0.0.1:{PORT}/_motion.html")
    print(f"  /api 反代  : → http://{BACKEND_HOST}:{BACKEND_PORT}/api/v1/*")
    Server(("127.0.0.1", PORT), Handler).serve_forever()
