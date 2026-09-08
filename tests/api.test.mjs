// shared/api.js 解析与错误分类测试（stub fetch，不发真实请求）
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchQuotaLimit, ApiError } from "../shared/api.js";

const QUOTA_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? "" : JSON.stringify(body)),
  };
}

let calls;
let fetchImpl;
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  fetchImpl = null;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("成功解析：level + limits 按 nextResetTime 升序，鉴权头为裸 key", async () => {
  fetchImpl = async () => jsonResponse({
    code: 200, success: true,
    data: {
      level: "lite",
      limits: [
        { type: "CREDIT_LIMIT", unit: 6, number: 1, nextResetTime: 2000 },
        { type: "CREDIT_LIMIT", unit: 3, number: 5, nextResetTime: 1000 },
      ],
    },
  });
  const quota = await fetchQuotaLimit("k");
  assert.equal(quota.level, "lite");
  assert.deepEqual(quota.limits.map((l) => l.nextResetTime), [1000, 2000]);
  assert.equal(calls[0].url, QUOTA_URL);
  assert.equal(calls[0].init.headers.Authorization, "k");
});

test("错误分类：invalid_key / quota_context / server", async () => {
  fetchImpl = async () => jsonResponse({ code: 401, msg: "invalid api key", success: false });
  await assert.rejects(fetchQuotaLimit("k"), (e) => e instanceof ApiError && e.kind === "invalid_key");

  fetchImpl = async () => jsonResponse({ code: 500, msg: "额度仅限编码工具使用" });
  await assert.rejects(fetchQuotaLimit("k"), (e) => e.kind === "quota_context");

  fetchImpl = async () => jsonResponse({ success: false, msg: "boom" });
  await assert.rejects(fetchQuotaLimit("k"), (e) => e.kind === "server");
});

test("200 空 body：配额解析报 bad_data", async () => {
  fetchImpl = async () => jsonResponse(null);
  await assert.rejects(fetchQuotaLimit("k"), (e) => e.kind === "bad_data");
});

test("网络错误：自动重试一次后仍失败", async () => {
  let n = 0;
  fetchImpl = async () => { n++; throw new Error("socket down"); };
  await assert.rejects(fetchQuotaLimit("k"), (e) => e.kind === "network" && /网络错误/.test(e.message));
  assert.equal(n, 2);
});

test("超时中断：归类 network 且文案为请求超时", async () => {
  let n = 0;
  fetchImpl = async () => {
    n++;
    const e = new Error("aborted");
    e.name = "AbortError";
    throw e;
  };
  await assert.rejects(fetchQuotaLimit("k"), (e) => e.kind === "network" && e.message === "请求超时");
  assert.equal(n, 2);
});
