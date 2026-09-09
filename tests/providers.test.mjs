// shared/providers.js 注册表测试：契约完整性（后台循环依赖的接口字段）+ GLM/Go 实现行为。
// fetch 打桩，不发真实请求。
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS, PROVIDER_MAP } from "../shared/providers.js";

// 后台刷新/降级/历史/提醒循环实际调用的字段；新增供应商缺一项会在运行时才暴露，这里静态兜底
const CONTRACT = [
  "id", "name", "officialUrl", "defaults", "fetchUsage", "headlinePct",
  "hasUsage", "emptyData", "applyConfig", "historyEntries", "notifyItems",
];

test("注册表契约：glm/go 顺序固定、id 唯一、每项实现完整接口", () => {
  // 徽章循环与快照 providers 顺序依赖注册顺序，固定为 glm → go
  assert.deepEqual(PROVIDERS.map((p) => p.id), ["glm", "go"]);
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length);
  for (const p of PROVIDERS) {
    for (const key of CONTRACT) {
      assert.ok(p[key] !== undefined, `${p.id}.${key} 缺失`);
    }
    assert.equal(typeof p.fetchUsage, "function");
    assert.equal(typeof p.defaults.enabled, "boolean");
  }
  assert.equal(PROVIDER_MAP.glm, PROVIDERS[0]);
  assert.equal(PROVIDER_MAP.go, PROVIDERS[1]);
});

/* ---------- fetch 桩 ---------- */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? "" : JSON.stringify(body)),
    json: async () => JSON.parse(JSON.stringify(body)),
  };
}

function glmBody(limits) {
  return { code: 200, success: true, data: { level: "lite", limits } };
}
const GLM_LIMITS = [
  { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 400, remaining: 1600, percentage: 20, nextResetTime: 1000 },
  { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 800, remaining: 9200, percentage: 8, nextResetTime: 2000 },
];
const GO_BODY = {
  usage: {
    rolling: { status: "ok", percent: 96, resetsAt: "2026-09-08T10:00:00Z" },
    weekly: { status: "ok", percent: 10, resetsAt: "2026-09-14T00:00:00Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-10-01T00:00:00Z" },
  },
};

test("GLM：fetchUsage 整形（limits 带 name、等级映射、planExpiry 跟随配置）", async () => {
  globalThis.fetch = async () => jsonResponse(glmBody(structuredClone(GLM_LIMITS)));
  const data = await PROVIDER_MAP.glm.fetchUsage({ apiKey: "k", planExpiry: "2026-10-01" });
  assert.equal(data.level, "lite");
  assert.equal(data.levelName, "Lite");
  assert.equal(data.planExpiry, "2026-10-01");
  assert.deepEqual(data.limits.map((l) => l.name), ["5小时额度", "每周额度"]);
});

test("GLM：headlinePct 优先 5 小时、无 h5 时回退每周、钳制异常值", async () => {
  const p = PROVIDER_MAP.glm;
  globalThis.fetch = async () => jsonResponse(glmBody(structuredClone(GLM_LIMITS)));
  const data = await p.fetchUsage({ apiKey: "k" });
  assert.equal(p.headlinePct(data), 20);

  const weeklyOnly = { ...data, limits: data.limits.filter((l) => l.unit !== 3) };
  assert.equal(p.headlinePct(weeklyOnly), 8);

  assert.equal(p.headlinePct({ limits: [] }), null);
  assert.equal(p.headlinePct(null), null);
  assert.equal(p.headlinePct({ limits: [{ type: "CREDIT_LIMIT", percentage: NaN }] }), null);
  assert.equal(p.headlinePct({ limits: [{ type: "CREDIT_LIMIT", percentage: 250 }] }), 100);
});

test("GLM：降级三件套 hasUsage/emptyData/applyConfig", () => {
  const p = PROVIDER_MAP.glm;
  assert.equal(p.hasUsage(null), false);
  assert.equal(p.hasUsage({ error: true }), false);
  assert.equal(p.hasUsage({ limits: [] }), false);
  assert.equal(p.hasUsage({ limits: [{}] }), true);
  assert.deepEqual(p.emptyData({ planExpiry: "2026-10-01" }),
    { level: "unknown", levelName: "unknown", planExpiry: "2026-10-01", limits: [] });
  // 到期日期来自设置，降级复用旧数据时也要跟随当前配置
  assert.deepEqual(p.applyConfig({ limits: [{}], planExpiry: "旧" }, { planExpiry: "新" }),
    { limits: [{}], planExpiry: "新" });
});

test("GLM：historyEntries 仅 h5/weekly；notifyItems 只报 ≥bad 的窗口", async () => {
  const p = PROVIDER_MAP.glm;
  globalThis.fetch = async () => jsonResponse(glmBody(structuredClone(GLM_LIMITS)));
  const data = await p.fetchUsage({ apiKey: "k" });
  assert.deepEqual(p.historyEntries(data).map((e) => e.key), ["h5", "weekly"]);
  assert.deepEqual(p.historyEntries(data).map((e) => e.pct), [20, 8]);
  assert.deepEqual(p.historyEntries({ limits: "bad" }), []);

  assert.deepEqual(p.notifyItems(data), []); // 20/8 均低于阈值
  const hot = structuredClone(data);
  hot.limits[0].percentage = 97;
  assert.deepEqual(p.notifyItems(hot), [{ key: "h5", title: "5 小时额度已用 97%" }]);
});

test("Go：fetchUsage 与 headlinePct 取 rolling 窗口", async () => {
  const p = PROVIDER_MAP.go;
  globalThis.fetch = async () => jsonResponse(structuredClone(GO_BODY));
  const data = await p.fetchUsage({ apiKey: "k" });
  assert.deepEqual(data.windows.map((w) => w.key), ["rolling", "weekly", "monthly"]);
  assert.equal(p.headlinePct(data), 96);
  assert.equal(p.headlinePct({ windows: [] }), null);
  assert.equal(p.headlinePct(null), null);
});

test("Go：降级三件套 emptyData 带 error 占位、applyConfig 原样返回", () => {
  const p = PROVIDER_MAP.go;
  assert.equal(p.hasUsage(null), false);
  assert.equal(p.hasUsage({ error: true }), false);
  assert.equal(p.hasUsage({ windows: [] }), false);
  assert.equal(p.hasUsage({ windows: [{}] }), true);
  assert.deepEqual(p.emptyData({}, new Error("boom")), { error: true, message: "boom" });
  const prev = { windows: [{}] };
  assert.equal(p.applyConfig(prev, { apiKey: "x" }), prev);
});

test("Go：notifyItems 按窗口名生成、historyEntries 全窗口", async () => {
  const p = PROVIDER_MAP.go;
  globalThis.fetch = async () => jsonResponse(structuredClone(GO_BODY));
  const data = await p.fetchUsage({ apiKey: "k" });
  assert.deepEqual(p.notifyItems(data), [{ key: "rolling", title: "5 小时额度已用 96%" }]);
  assert.deepEqual(p.historyEntries(data).map((e) => e.key), ["rolling", "weekly", "monthly"]);
  assert.deepEqual(p.historyEntries(null), []);
  assert.deepEqual(p.notifyItems(null), []);
});
