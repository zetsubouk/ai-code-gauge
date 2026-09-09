// DeepSeek 余额查询（官方文档端点 /user/balance，Bearer API Key）。
// DeepSeek 为按量计费（无时间窗额度），扩展展示余额与本地推导的消耗速度。

import { fetchWithTimeout } from "./net.js";

const ENDPOINT = "https://api.deepseek.com/user/balance";

class DsError extends Error {
  constructor(message, kind = "unknown") {
    super(message);
    this.kind = kind; // invalid_key | network | server | bad_data
  }
}

/** 查询账户余额。返回 { isAvailable, currency, total, granted, toppedUp }（金额为数字）。 */
export async function fetchBalance(apiKey) {
  try {
    const resp = await fetchWithTimeout(ENDPOINT, {
      headers: { Authorization: "Bearer " + apiKey },
    });
    let json = null;
    try { json = await resp.json(); } catch { json = null; }

    if (!resp.ok) {
      const msg = (json && (json.message || json.msg)) || `HTTP ${resp.status}`;
      const kind = resp.status === 401 || resp.status === 403 ? "invalid_key" : "server";
      throw new DsError(msg, kind);
    }
    const infos = json && Array.isArray(json.balance_infos) ? json.balance_infos : [];
    // 优先 CNY 账户（国内 Key），否则取第一条
    const info = infos.find((b) => b && b.currency === "CNY") || infos[0];
    if (!info) throw new DsError("余额接口无数据", "bad_data");

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const total = num(info.total_balance);
    if (total === null) throw new DsError("余额字段异常", "bad_data");
    return {
      isAvailable: json.is_available === true,
      currency: info.currency || "CNY",
      total,
      granted: num(info.granted_balance) ?? 0,
      toppedUp: num(info.topped_up_balance) ?? 0,
    };
  } catch (e) {
    if (e instanceof DsError) throw e;
    if (e && e.name === "AbortError") throw new DsError("请求超时", "network");
    throw new DsError("网络错误：" + (e && e.message ? e.message : e), "network");
  }
}

export { DsError };
