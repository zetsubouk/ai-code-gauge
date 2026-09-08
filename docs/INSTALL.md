# 安装与发布指南

## 一、本机加载（Chrome 开发者模式）

1. 打开 `chrome://extensions`。
2. 打开右上角**「开发者模式」**开关。
3. 点击左上角**「加载已解压的扩展程序」**，选择本项目根目录（含 `manifest.json` 的目录）。
4. 浏览器工具栏出现扩展图标，点击即可打开用量面板。

## 二、首次配置

1. 点击扩展图标，进入设置页。
2. 勾选「GLM（智谱中国大陆版）」，到 [bigmodel.cn](https://open.bigmodel.cn/) -> 后台 -> API Keys，复制你的 API Key 粘贴进去。
   （同一密钥即你在 Claude Code / ZCode 等工具中配置 GLM Coding Plan 用的那个。）
3. 如需同时监控 OpenCode Go，勾选后填入 opencode.ai 的 API Key。
4. 选择自动刷新间隔（默认 10 分钟），点**「保存并查询」**。
5. 面板随即分栏展示：GLM 为 5 小时/每周额度（及账号存在时的 MCP 次数），OpenCode Go 为 5 小时/每周/每月三条窗口用量；工具栏徽章实时显示 5 小时占比。

> 密钥只存本机 `chrome.storage.local`，只发给对应供应商官方接口（`open.bigmodel.cn` / `opencode.ai`）；不会上传任何第三方。

## 三、常见问题

- **提示「API Key 无效」**：密钥拼写/复制有误，或该 Key 未关联 Coding Plan 套餐。
- **「仅限在官方工具中使用」类错误**：套餐额度只认支持工具内的调用；本扩展只是查询，不影响此限制。
- **OpenCode Go 查询失败**：opencode.ai 面向国际用户，需保证该域名可访问；Key 无效时接口返回 401。
- **改动代码后不生效**：在 `chrome://extensions` 点扩展卡片上的「重新加载」。

## 四、打包发布（Chrome Web Store 用）

```bash
npm run build        # 在项目根目录执行，生成 dist/ai-code-gauge.zip
```

产物内含 `manifest.json / icons / background / popup / shared`，可直接上传到
[Chrome Web Store Dashboard](https://chromewebstore.google.com/u/0/devconsole/)。

发布前请准备：
- 图标已内置（16/32/48/128）。
- 商店简介/截图建议取自本扩展面板。
- 隐私说明可在开发者后台勾选：仅存储于本机、无分析/广告/追踪。

## 五、开发命令

```bash
npm test            # 单元测试（Node 18+ 内置 test runner，零依赖）
npm run test:api    # 线上接口冒烟：BIGMODEL_KEY=<glm key> GO_KEY=<go key> node scripts/test-api.mjs
npm run icons       # 重新生成图标（需 Python 3 + Pillow：pip install pillow）
npm run build       # 打包 zip
```

## 六、本地调试辅助脚本

- `scripts/repro-sw.mjs`：在 Node 中用 chrome 桩复现后台 `refresh()` 链路（需真实双密钥）：
  ```bash
  GLM=<glm key> GO=<go key> node scripts/repro-sw.mjs
  ```
- `scripts/harness.html`：弹窗 UI 渲染的本地预览（内置模拟数据）。需经 http 服务打开
  （如 `python -m http.server` 后访问 `/scripts/harness.html`），直接双击无法加载 module 脚本。
  注意：它是 popup.html 的手工同步副本，改动 popup 结构时需一并更新。