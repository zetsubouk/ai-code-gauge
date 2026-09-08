# 安全策略（Security Policy）

## 支持版本

以下版本提供安全修复支持：

| 版本 | 支持 |
|------|------|
| >= 1.0.0（最新） | ✅ 支持 |

## 报告安全漏洞

如果你发现与**密钥安全、数据传输、隐私**相关的漏洞，请**不要公开**张贴此类问题。

请通过 GitHub 的**私有漏洞报告**渠道提交（仓库页 → Security →
「Report a vulnerability」；需维护者先在 Settings → Code security 启用
Private vulnerability reporting）：

1. 私有渠道描述影响、复现步骤；**避免**在描述外公开敏感细节。
2. 如私有渠道不可用，可暂时联系维护者（见仓库主页「About」联系方式）。

我们会在收到后尽快响应并修复，随后在 CHANGELOG 中记录。

## 已知的安全边界

- 本扩展的 **API Key 仅存于浏览器本机 `chrome.storage.local`**，仅用于向对应供应商的官方监控接口鉴权：
  智谱 Key 发往 `open.bigmodel.cn`，OpenCode Go Key 发往 `opencode.ai`（Bearer 方式）。
- 扩展不含任何第三方请求、分析、广告或追踪代码。
- 所有请求端点与数据结构已记录在 [docs/API.md](docs/API.md)，便于社区审计。
- 请勿在任何公共位置（Issue、PR、截图）泄露你的 API Key。若怀疑 Key 已泄露，
  请立即到对应供应商后台（bigmodel.cn / opencode.ai）撤销并重新生成。