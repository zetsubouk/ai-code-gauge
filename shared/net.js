// 共享网络层：统一超时控制 + 网络级瞬态失败重试。
// 仅对网络错误（含超时中断）重试；HTTP 状态与接口业务错误由调用方按契约分类，不重试。

const RETRY_DELAY_MS = 800;

/**
 * 带超时与重试的 fetch。网络级错误每间隔 RETRY_DELAY_MS 重试，共尝试 1 + retries 次。
 * 返回 Response（可能非 2xx，由调用方按接口契约处理）。
 */
export async function fetchWithTimeout(url, { headers, timeoutMs = 20000, retries = 1 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { headers, signal: ctrl.signal });
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
