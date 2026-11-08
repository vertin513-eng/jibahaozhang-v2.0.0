# -*- coding: utf-8 -*-
"""把所有资源内联，打包成单文件 HTML。

用法：
    python tools/build_single.py
输出：
    dist/记把好账.html

单文件版本无需服务器，双击即可使用；因为不依赖 Service Worker，
适合通过微信/邮件发送或放在 U 盘里随身携带。
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def data_uri(path: Path, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def build() -> Path:
    html = read(ROOT / "index.html")

    css = read(ROOT / "css" / "app.css")
    html = html.replace(
        '<link rel="stylesheet" href="css/app.css" />',
        f"<style>\n{css}\n</style>",
    )

    # manifest 与图标：单文件下改用内嵌图标，移除 PWA 声明
    html = re.sub(r'\s*<link rel="manifest"[^>]*/>', "", html)
    html = re.sub(
        r'<link rel="icon"[^>]*/>',
        '<link rel="icon" href="%s" type="image/png" />'
        % data_uri(ROOT / "assets" / "icon-192.png", "image/png"),
        html,
    )
    html = re.sub(
        r'<link rel="apple-touch-icon"[^>]*/>',
        '<link rel="apple-touch-icon" href="%s" />'
        % data_uri(ROOT / "assets" / "icon-192.png", "image/png"),
        html,
    )

    # 内联脚本（保持加载顺序：util → store → security → importer → charts → app）
    for name in ("util", "store", "security", "importer", "charts", "app"):
        src = f'<script src="js/{name}.js"></script>'
        code = read(ROOT / "js" / f"{name}.js").replace("</script", "<\\/script")
        html = html.replace(src, f"<script>\n{code}\n</script>")

    banner = (
        "<!-- 记把好账 · 单文件离线版（由 tools/build_single.py 生成，"
        "请勿直接编辑；源码见项目根目录） -->\n"
    )
    html = html.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n" + banner, 1)

    DIST.mkdir(exist_ok=True)
    out = DIST / "记把好账.html"
    out.write_text(html, encoding="utf-8")
    print(f"已生成：{out}（{out.stat().st_size / 1024:.1f} KB）")
    return out


if __name__ == "__main__":
    build()
