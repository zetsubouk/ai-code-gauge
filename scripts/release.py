#!/usr/bin/env python
"""一键发版：同步 manifest / package.json / CHANGELOG 版本号并打 tag。

用法：
    python scripts/release.py <X.Y.Z> [--push] [--github] [--skip-tests]

流程：
  1. 校验：在 main 分支、工作区干净、版本号合法且大于当前、tag 未被占用、
     CHANGELOG「未发布」区有内容；
  2. 运行 npm test（--skip-tests 跳过；此时尚未改动任何文件，失败无残留）；
  3. 改写 CHANGELOG：「## [未发布]」标题改为「## [X.Y.Z] - 今日日期」；
  4. 同步 manifest.json 与 package.json 的 version 字段（仅替换该行，不动其余格式）；
  5. 提交 chore(release): vX.Y.Z 并打轻量 tag（与历史一致）；
  6. --push：推送 main 与 tag，触发 CI 打包 zip artifact；
  7. --github：本地 npm run build 产出 dist/ai-code-gauge.zip，用 gh 创建
     GitHub Release（正文取 CHANGELOG 该版本段落 + 固定安装页脚，与历史版本一致）。
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILES = ("manifest.json", "package.json")
UNRELEASED_HEADER = "## [未发布]"
INSTALL_FOOTER = (
    "\n---\n\n"
    "**安装**：下载 `ai-code-gauge.zip` 解压后，在 `chrome://extensions` 开启开发者模式并"
    "「加载已解压的扩展程序」。详见 docs/INSTALL.md。\n"
)


def fail(msg):
    print("发版失败：" + msg)
    sys.exit(1)


def run(cmd):
    # 统一走 shell：npm 在 Windows 上是 npm.cmd，无法直接 exec
    return subprocess.run(cmd, cwd=ROOT, shell=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as f:
        return f.read()


def write(path, text):
    with open(os.path.join(ROOT, path), "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def bump_version_files(ver):
    for path in VERSION_FILES:
        text = read(path)
        text, n = re.subn(r'("version"\s*:\s*")[\d.]+(")', rf"\g<1>{ver}\g<2>", text, count=1)
        if n != 1:
            fail(f"{path} 中未找到 version 字段")
        write(path, text)


def main():
    args = sys.argv[1:]
    flags = {a for a in args if a.startswith("--")}
    unknown = flags - {"--push", "--github", "--skip-tests"}
    if unknown:
        fail(f"未知参数：{' '.join(sorted(unknown))}")
    pos = [a for a in args if not a.startswith("--")]
    if len(pos) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+", pos[0]):
        fail("用法：python scripts/release.py <X.Y.Z> [--push] [--github] [--skip-tests]")
    ver = pos[0]
    tag = f"v{ver}"

    # --- 校验 ---
    if run("git rev-parse --abbrev-ref HEAD").stdout.strip() != "main":
        fail("请在 main 分支发版")
    if run("git status --porcelain").stdout.strip():
        fail("工作区不干净，请先提交或暂存改动")
    old = re.search(r'"version"\s*:\s*"([\d.]+)"', read("manifest.json")).group(1)
    if tuple(map(int, ver.split("."))) <= tuple(map(int, old.split("."))):
        fail(f"版本号需大于当前版本 {old}")
    if run(f"git rev-parse --quiet --verify {tag}").returncode == 0:
        fail(f"tag {tag} 已存在")

    changelog = read("CHANGELOG.md")
    head = changelog.find(UNRELEASED_HEADER)
    if head < 0:
        fail("CHANGELOG.md 缺少「## [未发布]」标题")
    body_start = head + len(UNRELEASED_HEADER)
    body_end = changelog.find("\n## [", body_start)
    if body_end < 0:
        body_end = len(changelog)
    notes = changelog[body_start:body_end].strip("\n")
    if not notes.strip():
        fail("CHANGELOG「未发布」区没有内容，无版本可发")

    if "--skip-tests" not in flags:
        print("== 运行单元测试 ==")
        r = run("npm test")
        print(r.stdout[-2000:])
        if r.returncode != 0:
            fail("单元测试未通过")

    # --- 改写文件 ---
    today = date.today().isoformat()
    write("CHANGELOG.md",
          changelog[:head] + f"## [{ver}] - {today}" + changelog[body_start:])
    bump_version_files(ver)
    print(f"已同步版本号与 CHANGELOG：{old} -> {ver}（{today}）")

    # --- 提交与打 tag ---
    for cmd in (
        f'git add {" ".join(VERSION_FILES)} CHANGELOG.md',
        f'git commit -m "chore(release): {tag}"',
        f"git tag {tag}",
    ):
        r = run(cmd)
        if r.returncode != 0:
            fail(f"命令失败：{cmd}\n{r.stdout}\n"
                 f"如需回滚文件改动：git checkout -- {' '.join(VERSION_FILES)} CHANGELOG.md")
    print(f"已提交并打 tag：{tag}")

    if "--push" in flags:
        r = run("git push origin main")
        if r.returncode != 0:
            fail(f"推送 main 失败：{r.stdout}")
        r = run(f"git push origin {tag}")
        if r.returncode != 0:
            fail(f"推送 tag 失败（main 已推送）：{r.stdout}")
        print("已推送 main 与 tag，CI 将自动打包 zip artifact")

    if "--github" in flags:
        if not shutil.which("gh"):
            fail("未找到 gh 命令，请安装 GitHub CLI 后手动执行："
                 f"gh release create {tag} dist/ai-code-gauge.zip")
        print("== 本地打包 ==")
        r = run("npm run build")
        if r.returncode != 0 or not os.path.exists(os.path.join(ROOT, "dist", "ai-code-gauge.zip")):
            fail("打包失败：\n" + r.stdout)
        notes_file = os.path.join(tempfile.gettempdir(), f"release-notes-{tag}.md")
        with open(notes_file, "w", encoding="utf-8", newline="\n") as f:
            f.write(notes + "\n" + INSTALL_FOOTER)
        r = run(f'gh release create {tag} dist/ai-code-gauge.zip '
                f'--title "AI Coding Gauge {tag}" --notes-file "{notes_file}"')
        os.remove(notes_file)
        if r.returncode != 0:
            fail(f"创建 GitHub Release 失败（tag 已推送）：{r.stdout}")
        print(f"已创建 GitHub Release：AI Coding Gauge {tag}")


if __name__ == "__main__":
    main()
