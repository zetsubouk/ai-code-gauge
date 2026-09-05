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
- **24h 用量全 0 / 空白**：账号在该时段无对应消费，属正常。
- **改动代码后不生效**：在 `chrome://extensions` 点扩展卡片上的「重新加载」。

## 四、打包发布（Chrome Web Store 用）

```bash
npm run build        # 在项目根目录执行，生成 dist/glm-usage-monitor.zip
```

产物内含 `manifest.json / icons / background / popup / shared`，可直接上传到
[Chrome Web Store Dashboard](https://chrome.google.com/webstore/devconsole/)。

发布前请准备：
- 图标已内置（16/32/48/128）。
- 商店简介/截图建议取自本扩展面板。
- 隐私说明可在开发者后台勾选：仅存储于本机、无分析/广告/追踪。

## 五、开发命令

```bash
npm run test:api     # 接口冒烟测试：BIGMODEL_KEY=<key> node scripts/test-api.mjs
npm run icons        # 重新生成图标
npm run build        # 打包 zip
```