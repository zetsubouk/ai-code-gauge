# AI Coding Plan 用量监控 — 接口契约（已实测确认）

本文档列出现有供应商的用量查询接口与数据结构。所有端点均为**官方公开接口**；密钥仅用于向对应当局官方接口鉴权。

## 一、智谱 GLM（中国大陆版 `open.bigmodel.cn`）

> 鉴权：请求头 `Authorization: <apiKey>`（不加 Bearer 前缀）。
> 中国大陆版主机：`https://open.bigmodel.cn`。国际版（未启用）：`https://api.z.ai`，路径一致。

### 1. 配额/额度

```
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Header: Authorization: <apiKey>
```

实测响应（Lite 套餐）：

```jsonc
{
  "code": 200, "msg": "操作成功", "success": true,
  "data": {
    "level": "lite",                       // lite | pro | max
    "limits": [
      { "type": "CREDIT_LIMIT", "unit": 3, "number": 5,
        "usage": 2000, "currentValue": 412, "remaining": 1587,
        "percentage": 20, "nextResetTime": 1788417614736 },   // 5小时额度（窗口最短）
      { "type": "CREDIT_LIMIT", "unit": 6, "number": 1,
        "usage": 10000, "currentValue": 869, "remaining": 9130,
        "percentage": 8, "nextResetTime": 1788933313998 }     // 每周额度
    ]
  }
}
```

字段说明：
- `level`：套餐等级 → Lite / Pro / Max。
- `limits[]`：`CREDIT_LIMIT` 表示积分额度窗口；若账号存在独立 MCP 额度会以其他 type 返回。
  - `usage` = 该窗口总额度；`currentValue` = 已用；`remaining` = 剩余；`percentage` = 已用百分比。
  - `nextResetTime` = 下次重置的 Unix 毫秒时间戳。
- 解析规则：多个 `CREDIT_LIMIT` 按 `nextResetTime` **升序**，取前条目为 5 小时窗口，后续为每周。
  亦可按 `unit/number` 映射：`unit=3,number=5`→5小时；`unit=6,number=1`→每周。
- 注意：旧文档所说的 `TOKENS_LIMIT` / `TIME_LIMIT` 类型在当前账号返回中为 `CREDIT_LIMIT`，实现按实际字段兼容。

套餐积分额度（个人版，官方口径）：
| 套餐 | 5 小时积分 | 每周积分 | 单价 |
|---|---|---|---|
| Lite | 2,000 | 10,000 | ¥118/月 |
| Pro  | 12,000 | 60,000 | ¥538/月 |
| Max  | 28,000 | 140,000 | ¥1,078/月 |

### 2. 24 小时模型用量

> 注：自 v1.1.0 起扩展不再调用以下两个 24h 接口（面板展示已移除），保留本节仅作官方接口契约的审计参考。

```
GET https://open.bigmodel.cn/api/monitor/usage/model-usage
     ?startTime=yyyy-MM-dd HH:mm:ss & endTime=yyyy-MM-dd HH:mm:ss
Header: Authorization: <apiKey>
```

时间格式必须为 `yyyy-MM-dd HH:mm:ss`，否则返回 `code 500` 参数校验失败。

```jsonc
"data": {
  "x_time": ["2026-09-02 10:00", ...],         // 每小时刻度
  "modelCallCount": [...],                       // 每时段调用次数
  "tokensUsage": [...],                          // 每时段 token
  "granularity": "hourly",
  "totalUsage": {
    "totalModelCallCount": 174,
    "totalTokensUsage": 16439326,
    "modelSummaryList": [{ "modelName": "GLM-5.3-Flash", "totalTokens": 16439326, "sortOrder": 1 }]
  },
  "modelDataList": [...], "modelSummaryList": [...]
}
```

### 3. 24 小时工具用量

```
GET https://open.bigmodel.cn/api/monitor/usage/tool-usage
     ?startTime=... & endTime=...
```

```jsonc
"data": {
  "x_time": [...],
  "networkSearchCount": [...], "webReadMcpCount": [...], "zreadMcpCount": [...],
  "totalUsage": {
    "totalNetworkSearchCount": 0, "totalWebReadMcpCount": 0,
    "totalZreadMcpCount": 0, "totalSearchMcpCount": 0,
    "toolDetails": [], "toolSummaryList": []
  },
  "granularity": "hourly"
}
```

## 二、OpenCode Go（`opencode.ai`）

> 鉴权：请求头 `Authorization: Bearer <apiKey>`。实测仅带 `Authorization` 不加 Bearer 会返回 401。
> 该接口随服务器兼容 API 于合理延迟内返回；opencode.ai 面向国际用户，需可访问该域名。

### 用量窗口

```
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <go-api-key>
```

实测响应：

```jsonc
{
  "usage": {
    "rolling": { "status": "ok", "percent": 1,  "resetsAt": "2026-09-03T08:25:58.730Z" },  // 5 小时窗口
    "weekly":  { "status": "ok", "percent": 27, "resetsAt": "2026-09-07T00:00:00.730Z" },
    "monthly": { "status": "ok", "percent": 36, "resetsAt": "2026-09-17T04:14:27.730Z" }
  }
}
```

- 三个窗口：`rolling`（5 小时）、`weekly`（每周）、`monthly`（每月），仅返回 `percent`（已用百分比）与 `resetsAt`（下次重置 ISO 时间），**不返回美元数值**。
- 各窗口的美元限额为**已知档位的参考值**（扩展内硬编码于 `shared/go.js`）：rolling `$12`、weekly `$30`、monthly `$60`。官方不同订阅档位或调价后该数值不再准确，仅作辅助展示，以官方页面为准。
- 鉴权失败（Key 无效）：`{"type":"error","error":{"type":"AuthError","message":"Missing API key."}}`，HTTP 401。

## 三、通用边界与注意
- 套餐额度/消耗**仅统计**在官方支持工具内的编码用量；本扩展只做查询，不发起模型请求，不消耗任何套餐额度。
- `model-usage`/`tool-usage`（GLM）在账号无对应消费时返回空 body（200）或全 0，属正常。
- GLM 团队版套餐查询需额外 `Bigmodel-Organization` / `Bigmodel-Project` 请求头，本期未支持。
- OpenCode Go 当前**无**面向 API Key 的 24h 模型/工具用量接口（官方功能请求 #31084 尚未落地），故 Go 分栏仅展示三个窗口进度条。