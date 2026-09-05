#!/usr/bin/env python
"""打包扩展为 dist/ai-code-gauge.zip（仅运行时文件，无第三方依赖）。"""
import os, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
RUNTIME = ["manifest.json", "icons", "background", "popup", "shared"]
PREFIX = "ai-code-gauge/"

os.makedirs(DIST, exist_ok=True)
out = os.path.join(DIST, "ai-code-gauge.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for item in RUNTIME:
        src = os.path.join(ROOT, item)
        if os.path.isdir(src):
            for base, _dirs, files in os.walk(src):
                for f in files:
                    full = os.path.join(base, f)
                    rel = os.path.relpath(full, ROOT).replace("\\", "/")
                    zf.write(full, PREFIX + rel)
        else:
            zf.write(src, PREFIX + item)
print("已生成", out)