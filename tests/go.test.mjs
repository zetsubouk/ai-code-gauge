// shared/go.js 解析与错误分类测试（stub fetch，不发真实请求）
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetchGoUsage, GO_WINDOW_LIMITS, GoError } from "../shared/go.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(JSON.stringify(body)),
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

test("成功解析：三窗口 + Bearer 鉴权 + endTs 推算", async () => {
  fetchImpl = async () => jsonResponse({
    usage: {
      rolling: { status: "ok", percent: 1, resetsAt: "2026-09-03T08:25:58.730Z" },
      weekly: { status: "ok", percent: 27, resetsAt: "2026-09-07T00:00:00.730Z" },
      monthly: { status: "ok", percent: 36, resetsAt: "2026-09-17T04:14:27.730Z" },
    },
  });
  const data = await fetchGoUsage("gk");
  assert.equal(calls[0].init.headers.Authorization, "Bearer gk");
  assert.deepEqual(data.windows.map((w) => w.key), ["rolling", "weekly", "monthly"]);
  const rolling = data.windows[0];
  assert.equal(rolling.name, "5 小时");
  assert.equal(rolling.percent, 1);
  assert.equal(rolling.limit, GO_WINDOW_LIMITS.rolling);
  assert.equal(rolling.endTs, Date.parse("2026-09-03T08:25:58.730Z"));
});

test("鉴权失败：AuthError 归类 invalid_key", async () => {
  fetchImpl = async () =>
    jsonResponse({ type: "error", error: { type: "AuthError", message: "Missing API key." } }, 401);
  await assert.rejects(fetchGoUsage("bad"), (e) => e instanceof GoError && e.kind === "invalid_key");
});

test("无 usage 数据：bad_data", async () => {
  fetchImpl = async () => jsonResponse({});
  await assert.rejects(fetchGoUsage("k"), (e) => e.kind === "bad_data");
});

test("percent 非法或缺失的窗口被过滤", async () => {
  fetchImpl = async () => jsonResponse({
    usage: { rolling: { percent: 10 }, weekly: { percent: "abc" }, monthly: {} },
  });
  const data = await fetchGoUsage("k");
  assert.deepEqual(data.windows.map((w) => w.key), ["rolling"]);
});

test("网络错误：重试一次后归类 network", async () => {
  let n = 0;
  fetchImpl = async () => { n++; throw new Error("socket down"); };
  await assert.rejects(fetchGoUsage("k"), (e) => e.kind === "network" && /网络错误/.test(e.message));
  assert.equal(n, 2);
});
