# 贡献指南

感谢你愿意为本项目贡献代码、文档或反馈！请先阅读本节，让你的贡献更顺畅。

## 行为准则

请保持友善、专业。本项目欢迎各类背景的贡献者，任何骚扰、歧视行为将不被容忍。详见 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（如存在）。

## 我该如何贡献

### 1. 报告 Bug / 提出功能建议

- 先在 [Issues](../../issues) 中搜索是否已有相同问题，避免重复。
- 若不存在，请新建 Issue，尽量包含：
  - 复现步骤、期望行为与实际行为；
  - 浏览器版本、操作系统；
  - 若涉及接口数据，脱敏后附上返回片段。

### 2. 提交代码

1. Fork 本仓库并克隆到本地：
   ```bash
   git clone https://github.com/<你的用户名>/<仓库名>.git
   cd <仓库名>
   ```
2. 创建功能分支（建议 `feature/xxx` 或 `fix/xxx`）：
   ```bash
   git checkout -b feature/你的功能名
   ```
3. 编写代码，保持与现有风格一致。
4. **本地自测**：运行单元测试与接口冒烟检查：
   ```bash
   npm test          # shared/ 纯函数与后台 refresh() 集成测试（Node 18+，零依赖）
   BIGMODEL_KEY=<你的key> npm run test:api   # 线上接口冒烟（可选，无 key 跳过）
   ```
   CI 会在 push/PR 时自动跑语法检查与 `npm test`。
   若改动涉及打包，运行 `npm run build` 确认可产出 `dist/`。
5. 提交（使用清晰、规范的中文或英文提交信息）：
   ```bash
   git add .
   git commit -m "feat: 新增 xxx"
   ```
6. 推送并创建 Pull Request：
   ```bash
   git push origin feature/你的功能名
   ```
   在 PR 描述中说明改动目的、涉及文件与测试结果。

## 代码规范

- **零构建依赖**：本项目刻意不引入 webpack/vite，保持原生 JS + MV3 结构。请勿引入构建链路。
- 模块化：通用逻辑放 `shared/`，业务逻辑分 `background/` 与 `popup/`。
- 新增供应商：在 `shared/providers.js` 注册条目（拉取/降级/历史/提醒的契约见文件头注释），后台无需改动；弹窗面板需单独定制。
- 中文界面文案；代码注释保持简洁。
- 修改 `shared/constants.js` / `shared/api.js` 涉及接口契约时，务必同步更新 `docs/API.md`。

## Issue / PR 模板

提交前可参考以下模板结构（Issue 或 PR 描述）：

```
## 目的
（一句话说明）

## 改动
- （列出关键改动与涉及文件）

## 验证
- （列出执行过的测试/踩点：语法检查、接口冒烟、打包等）
```

## 审核流程

- 维护者会尽快 review PR，可能需要你补充说明或调整。
- 合并到 `main` 后生效；版本号按 SemVer 递增并更新 `CHANGELOG.md`。

感谢你的贡献！