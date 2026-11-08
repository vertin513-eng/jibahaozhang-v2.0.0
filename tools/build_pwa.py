# -*- coding: utf-8 -*-
"""生成可直接托管的 PWA 目录与 zip（供 iPhone「添加到主屏幕」使用）。

用法：
    python tools/build_pwa.py
输出：
    dist/pwa/                 # 拖到 Netlify Drop / 上传到任意静态托管
    dist/记把好账-PWA.zip      # 根目录即站点根目录，解压后可直接托管
"""
from __future__ import annotations

import os
import shutil
import stat
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "dist" / "pwa"
OUT_ZIP = ROOT / "dist" / "记把好账-PWA.zip"

FILES = [
    "index.html",
    "manifest.webmanifest",
    "sw.js",
]
DIRS = ["css", "js", "assets"]


def main() -> None:
    if OUT_DIR.exists():
        # 原图可能带只读属性，删除前先恢复写权限
        for p in OUT_DIR.rglob("*"):
            try:
                os.chmod(p, stat.S_IWRITE | stat.S_IREAD)
            except OSError:
                pass
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True)

    for name in FILES:
        shutil.copy2(ROOT / name, OUT_DIR / name)
    for name in DIRS:
        shutil.copytree(
            ROOT / name,
            OUT_DIR / name,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".*", "*.lock", "brand-source.jpg", "icon.svg"),
        )

    # Netlify / Cloudflare Pages 都识别的响应头；其它静态托管会忽略此文件。
    (OUT_DIR / "_headers").write_text(
        "/sw.js\n  Cache-Control: no-cache\n"
        "/manifest.webmanifest\n  Content-Type: application/manifest+json\n",
        encoding="utf-8",
    )

    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for p in sorted(OUT_DIR.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(OUT_DIR).as_posix())

    files = [p for p in OUT_DIR.rglob("*") if p.is_file()]
    print(f"PWA 目录：{OUT_DIR}（{len(files)} 个文件）")
    print(f"PWA 压缩包：{OUT_ZIP}（{OUT_ZIP.stat().st_size / 1024:.1f} KB）")


if __name__ == "__main__":
    main()
