# 路线图（Roadmap）

按优先级排列的后续改造方向。已完成项请移入 [CHANGELOG.md](CHANGELOG.md) 并从此处删除。

## P1 · 本地功能改造（无后端依赖）

- **用量历史与趋势**：`chrome.storage.local` 保存每个窗口的每日快照（有界环形缓冲，如 30 天），
  弹窗展示近 7 日迷你趋势条。无需新增权限。
- **阈值提醒通知**：5h / 每周窗口 ≥95% 时通过 `chrome.notifications` 提醒。
  需新增可选权限、设置开关与冷却时间（避免重复打扰）。
- **设置导出 / 导入**：JSON 备份与迁移（密钥可选包含，导出前明确提示风险）。

## P2 · 供应商扩展与国际化

- **GLM 国际版**：支持 `api.z.ai` 主机（路径与大陆版一致，见 [API.md](API.md)），
  供应商设置中增加主机/版本选项；需真实 Key 冒烟验证。
- **GLM 团队版**：可选填写 `Bigmodel-Organization` / `Bigmodel-Project` 请求头
  （API.md 已记录为已知边界）；需团队账号验证。
- **供应商注册表重构**：`shared/providers.js` 抽象 `{id, name, fetchUsage}`，
  去除 service-worker 中 glm/go 硬编码分支，新供应商以模块接入。
  上线 i18n 前需同步 `scripts/package.py` 的 `BASE_DIRS`（已含 `_locales` 探测）。

## P3 · 发布工程

- **Chrome Web Store 上架**：商店文案、隐私问卷（仅本机存储、无追踪）、
  隐私政策页（可用本仓库 [SECURITY.md](SECURITY.md) / README）；上架链接回填 README。
- **发布脚本化**：`scripts/release.py` 一键同步 manifest / package.json / CHANGELOG 版本号并打 tag，
  触发 CI 产出 zip（见 `.github/workflows/ci.yml` build job）。
- **维护者待办**：仓库 Settings → Code security 启用 Private vulnerability reporting
  （SECURITY.md 已指引该渠道）。

## 已知取舍（暂不动）

- 双供应商布局假设固化在 CSS（单栏 360px / 双栏 560px / 两列 grid）；
  引入第三家供应商时需改为按面板数自适应。
- `scripts/harness.html` 是 popup.html 的手工副本，存在漂移风险；
  长期可考虑在单测中以 DOM 解析方式直接校验 popup.html 结构。
