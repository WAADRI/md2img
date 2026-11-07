#!/usr/bin/env python3
"""MD2IMG 客户端示例:把 Markdown 文件渲染为图片。

用法:python examples/client.py reply.md [输出.png] [主题]
"""
import os
import sys
import json
import urllib.request
import urllib.error
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("用法: python client.py reply.md [输出.png] [主题]")
        sys.exit(1)

    src = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("output.png")
    theme = sys.argv[3] if len(sys.argv) > 3 else "light"
    base = os.environ.get("MD2IMG_URL", "http://localhost:8307")

    payload = json.dumps({
        "markdown": src.read_text(encoding="utf-8"),
        "theme": theme,
        "width": 800,
        "scale": 2,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{base}/api/render",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
            print(f"✅ 已生成 {out} ({resp.headers.get('x-md2img-width')}x{resp.headers.get('x-md2img-height')})")
    except urllib.error.HTTPError as e:
        print(f"渲染失败 HTTP {e.code}: {e.read().decode('utf-8', 'ignore')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
