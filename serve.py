# -*- coding: utf-8 -*-
"""辣脚记账 · 本地预览服务器

用法：
    python serve.py                # http://127.0.0.1:5178
    python serve.py --port 8080    # 指定端口
    python serve.py --lan          # 监听 0.0.0.0，手机同一 Wi-Fi 可访问
    python serve.py --open         # 自动打开默认浏览器

说明：
- 仅用于本地预览 / 安装 PWA（Service Worker 需要 http/https 环境）。
- 直接双击 index.html 也可以记账，但离线缓存与「添加到主屏幕」不可用。
"""
from __future__ import annotations

import argparse
import http.server
import socket
import socketserver
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # 开发预览禁用缓存，避免改了代码看不到效果
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Service-Worker-Allowed", "/")
        super().end_headers()

    def log_message(self, fmt, *args):  # noqa: A003
        if getattr(self.server, "verbose", False):
            super().log_message(fmt, *args)


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main() -> None:
    parser = argparse.ArgumentParser(description="辣脚记账本地预览服务器")
    parser.add_argument("--port", type=int, default=5178, help="端口，默认 5178")
    parser.add_argument("--lan", action="store_true", help="监听 0.0.0.0，允许局域网访问")
    parser.add_argument("--open", action="store_true", help="启动后打开浏览器")
    parser.add_argument("--verbose", action="store_true", help="打印访问日志")
    args = parser.parse_args()

    host = "0.0.0.0" if args.lan else "127.0.0.1"

    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True

    with Server((host, args.port), Handler) as httpd:
        httpd.verbose = args.verbose
        url = f"http://{'127.0.0.1' if not args.lan else local_ip()}:{args.port}/index.html"
        print("辣脚记账已启动：", url)
        if args.lan:
            print(f"手机访问（同一 Wi-Fi）：http://{local_ip()}:{args.port}/index.html")
        print("按 Ctrl+C 停止。")
        if args.open:
            threading.Timer(0.4, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()
