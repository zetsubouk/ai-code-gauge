// 官方监控接口封装：带鉴权、超时、错误分类、数据解析。
// 密钥只用于向 open.bigmodel.cn 官方接口鉴权。
// 注：24h 模型/工具用量封装自 v1.1.0 起随展示一并移除（契约仍记录于 docs/API.md）。

import { ENDPOINTS } from "./constants.js";
import { fetchWithTimeout } from "./net.js";

class ApiError extends Error {
  constructor(message, kind = "unknown") {
    super(message);
    this.kind = kind; // invalid_key | quota_context | network | server | bad_data
  }
}

async function request(url, apiKey, extraQuery = "") {
  try {
    const query = extraQuery ? `${url}?${extraQuery}` : url;
    const resp = await fetchWithTimeout(query, {
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
    });
    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!json) {
      // 200 空 body 属正常（如 model-usage 无数据时）
      if (resp.status === 200) return null;
      throw new ApiError(`HTTP ${resp.status}：响应无法解析`, "server");
    }

    // 平台统一错误兜底
    if (json.code && json.code !== 200 && !json.success) {
      const msg = String(json.msg || json.error || `错误码 ${json.code}` || "");
      let kind = "server";
      if (/key|授权|apikey|token|401|鉴权/i.test(msg)) kind = "invalid_key";
      if (/仅限|编码工具|coding|工具|产品环境|编码场景/i.test(msg)) kind = "quota_context";
      throw new ApiError(msg, kind);
    }

    if (json.success === false) {
      throw new ApiError(String(json.msg || "request failed"), "server");
    }

    return json;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === "AbortError") throw new ApiError("请求超时", "network");
    throw new ApiError("网络错误：" + (e && e.message ? e.message : e), "network");
  }
}

/** 配额/额度：返回 {level, limits:[...]}，limits 按 nextResetTime 升序。 */
export async function fetchQuotaLimit(apiKey) {
  const json = await request(ENDPOINTS.quotaLimit, apiKey);
  if (!json || !json.data) throw new ApiError("配额接口无数据", "bad_data");
  const limits = (json.data.limits || []).slice().sort(
    (a, b) => (a.nextResetTime || 0) - (b.nextResetTime || 0)
  );
  return { level: json.data.level || "unknown", limits };
}

export { ApiError };
