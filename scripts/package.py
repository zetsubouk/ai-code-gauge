#!/usr/bin/env python
"""打包扩展为 dist/ai-code-gauge.zip（仅运行时文件，无第三方依赖）。

运行清单 = 基础目录 ∪ manifest.json 引用的文件；manifest 引用了但不存在的文件
直接报错退出，防止商店包静默缺文件（如未来新增 _locales/options 页）。
同时校验 manifest 与 package.json 的版本号一致。
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
PREFIX = "ai-code-gauge/"

# 运行时基础目录；存在才打包（如未来新增 _locales/）
BASE_DIRS = ["icons", "background", "popup", "shared", "_locales"]


def fail(msg):
    print("打包失败：" + msg)
    sys.exit(1)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def main():
    manifest = load_json(os.path.join(ROOT, "manifest.json"))
    pkg = load_json(os.path.join(ROOT, "package.json"))
    if manifest.get("version") != pkg.get("version"):
        fail(f"版本号不一致：manifest={manifest.get('version')} package.json={pkg.get('version')}")

    # 收集 manifest 引用的运行时文件
    refs = {"manifest.json"}
    refs.add(manifest["background"]["service_worker"])
    refs.add(manifest["action"]["default_popup"])
    for section in (manifest.get("icons", {}), manifest.get("action", {}).get("default_icon", {})):
        refs.update(section.values())

    dirs = [d for d in BASE_DIRS if os.path.isdir(os.path.join(ROOT, d))]
    covered = [d + "/" for d in dirs]

    # 目录覆盖不到的引用作为独立文件打包；引用缺失直接报错
    standalone = []
    for ref in sorted(refs):
        if not os.path.exists(os.path.join(ROOT, ref)):
            fail(f"manifest 引用的文件不存在：{ref}")
        if not any(ref.startswith(c) for c in covered):
            standalone.append(ref)

    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, "ai-code-gauge.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for d in dirs:
            src = os.path.join(ROOT, d)
            for base, _dirs, files in os.walk(src):
                for f in files:
                    full = os.path.join(base, f)
                    rel = os.path.relpath(full, ROOT).replace("\\", "/")
                    zf.write(full, PREFIX + rel)
        for ref in standalone:
            zf.write(os.path.join(ROOT, ref), PREFIX + ref)
    print("已生成", out)


if __name__ == "__main__":
    main()
