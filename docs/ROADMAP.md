# 路线图（Roadmap）

按优先级排列的后续改造方向。已完成项请移入 [CHANGELOG.md](CHANGELOG.md) 并从此处删除。

## P1 · 供应商扩展与国际化

- **供应商注册表重构**：`shared/providers.js` 抽象 `{id, name, fetchUsage}`，
  去除 service-worker 中 glm/go 硬编码分支，新供应商以模块接入。
- **GLM 国际版**：支持 `api.z.ai` 主机（路径与大陆版一致，见 [API.md](API.md)），
  供应商设置中增加主机/版本选项；需真实 Key 冒烟验证。
- **GLM 团队版**：可选填写 `Bigmodel-Organization` / `Bigmodel-Project` 请求头
  （API.md 已记录为已知边界）；需团队账号验证。
- **界面 i18n**：`_locales/zh_CN` + `en`，弹窗文案走 `chrome.i18n`；
  `scripts/package.py` 的 `BASE_DIRS` 已含 `_locales` 探测，不会漏打包。

## P2 · 发布工程

- **Chrome Web Store 上架**：商店文案、隐私问卷（仅本机存储、无追踪）、
  隐私政策页（可用本仓库 [SECURITY.md](SECURITY.md) / README）；上架链接回填 README。
  发版用 `npm run release -- <版本号> --push --github` 一键完成
  （`scripts/release.py`：同步版本号/CHANGELOG、打 tag 触发 CI、建 GitHub Release）。
- **维护者待办**：仓库 Settings → Code security 启用 Private vulnerability reporting
  （SECURITY.md 已指引该渠道）。

## 已知取舍（暂不动）

- 双供应商布局假设固化在 CSS（单栏 360px / 双栏 560px / 两列 grid）；
  引入第三家供应商时需改为按面板数自适应。
- `scripts/harness.html` 是 popup.html 的手工副本，存在漂移风险；
  长期可考虑在单测中以 DOM 解析方式直接校验 popup.html 结构。
- 用量历史依赖弹窗/后台刷新触发记录，长期未打开扩展会产生历史空洞（属预期行为）。
