// background/service-worker.js refresh() 集成测试：chrome 桩 + fetch 固定数据，
// 验证快照结构、徽章顺序与阈值色、双供应商故障隔离。不发真实请求。
import { test, before } from "node:test";
import assert from "node:assert/strict";

/* ---------- chrome 桩 ---------- */
const store = {};
const alarms = [];
const badge = { texts: [], colors: [] };
const notifyCalls = [];
const captured = {};
const noop = async () => {};

globalThis.chrome = {
  storage: {
    local: {
      get: async (keys) => {
        const list = Array.isArray(keys) ? keys : [keys];
        const o = {};
        for (const k of list) if (k in store) o[k] = store[k];
        return o;
      },
      set: async (obj) => Object.assign(store, obj),
    },
  },
  alarms: {
    clear: async (name) => {
      const i = alarms.indexOf(name);
      if (i >= 0) alarms.splice(i, 1);
    },
    create: async (name) => { if (!alarms.includes(name)) alarms.push(name); },
    onAlarm: { addListener: noop },
  },
  action: {
    setBadgeText: async (o) => badge.texts.push(o.text),
    setBadgeBackgroundColor: async (o) => badge.colors.push(o.color),
    setIcon: async () => {},
  },
  notifications: {
    create: async (opts) => notifyCalls.push(opts),
  },
  runtime: {
    onInstalled: { addListener: noop },
    onStartup: { addListener: noop },
    onMessage: { addListener: (cb) => { captured.handler = cb; } },
    getURL: (p) => "chrome-extension://test/" + p,
  },
};

/* ---------- fetch 桩 ---------- */
function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === null ? "" : JSON.stringify(body)),
    json: async () => JSON.parse(JSON.stringify(body)),
  };
}

const GLM_OK = {
  code: 200, success: true,
  data: {
    level: "lite",
    limits: [
      { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 2000, currentValue: 400, remaining: 1600, percentage: 20, nextResetTime: 1000 },
      { type: "CREDIT_LIMIT", unit: 6, number: 1, usage: 10000, currentValue: 800, remaining: 9200, percentage: 8, nextResetTime: 2000 },
    ],
  },
};
const GO_OK = {
  usage: {
    rolling: { status: "ok", percent: 30, resetsAt: "2026-09-08T10:00:00Z" },
    weekly: { status: "ok", percent: 10, resetsAt: "2026-09-14T00:00:00Z" },
    monthly: { status: "ok", percent: 5, resetsAt: "2026-10-01T00:00:00Z" },
  },
};

let glmMode = "ok"; // ok | auth_error
let goMode = "ok";
let glmH5Pct = null; // 覆盖 5h 窗口百分比（通知阈值测试用）
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("bigmodel.cn")) {
    if (glmMode === "auth_error") return jsonResponse({ code: 401, msg: "invalid api key", success: false });
    const payload = structuredClone(GLM_OK);
    if (glmH5Pct !== null) payload.data.limits[0].percentage = glmH5Pct;
    return jsonResponse(payload);
  }
  if (u.includes("opencode.ai")) {
    if (goMode === "auth_error") return jsonResponse({ type: "error", error: { type: "AuthError", message: "Missing API key." } }, 401);
    return jsonResponse(GO_OK);
  }
  throw new Error("unexpected url: " + u);
};

let sw;
before(async () => {
  store.providers = {
    glm: { enabled: true, apiKey: "glm-key", planExpiry: "" },
    go: { enabled: true, apiKey: "go-key" },
  };
  sw = await import("../background/service-worker.js");
});

async function send(msg) {
  return new Promise((resolve, reject) => {
    captured.handler(msg, {}, (resp) => {
      if (resp && resp.error) reject(new Error(resp.error));
      else resolve(resp);
    });
  });
}

test("双供应商成功：快照结构 + 徽章按 GLM→Go 顺序与阈值色", async () => {
  glmMode = "ok"; goMode = "ok";
  badge.texts = []; badge.colors = [];
  // 走 settingsChanged：真实保存路径会先 ensureAlarm 再刷新
  const resp = await send({ type: "settingsChanged" });
  assert.equal(resp.ok, true);
  assert.equal(resp.reason, "ok");

  const snap = resp.data;
  assert.equal(snap.providers.glm.level, "lite");
  assert.equal(snap.providers.glm.limits[0].name, "5小时额度");
  assert.deepEqual(snap.providers.go.windows.map((w) => w.key), ["rolling", "weekly", "monthly"]);
  assert.deepEqual(snap.errors, []);

  assert.deepEqual(store.badgeItems.map((i) => i.pct), [20, 30]);
  assert.equal(badge.texts.at(-1), "20%"); // 先显示 GLM
  assert.equal(badge.colors.at(-1), "#2E7D32"); // 20% → 绿
  assert.ok(alarms.includes("glm-refresh"));
  assert.ok(alarms.includes("badge-cycle")); // 双供应商 → 循环闹钟
});

test("故障隔离：GLM 鉴权失败不影响 Go 数据与徽章", async () => {
  glmMode = "auth_error"; goMode = "ok";
  badge.texts = [];
  const resp = await send({ type: "refresh" });
  assert.equal(resp.ok, false);
  assert.equal(resp.reason, "partial");
  assert.equal(resp.data.errors.length, 1);
  assert.equal(resp.data.errors[0].provider, "glm");
  assert.equal(resp.data.errors[0].kind, "invalid_key");
  assert.deepEqual(resp.data.providers.glm.limits, []);
  assert.equal(resp.data.providers.go.windows[0].percent, 30);

  // 徽章只剩 Go 一项：不循环，单条显示
  assert.deepEqual(store.badgeItems.map((i) => i.pct), [30]);
  assert.equal(badge.texts.at(-1), "30%");
});

test("双供应商均禁用：快照为空、ok、清理循环", async () => {
  glmMode = "ok"; goMode = "ok";
  store.providers = {
    glm: { enabled: false, apiKey: "glm-key", planExpiry: "" },
    go: { enabled: false, apiKey: "" },
  };
  const resp = await send({ type: "refresh" });
  assert.equal(resp.ok, true);
  assert.equal(resp.reason, "ok");
  assert.equal(resp.data.providers.glm, null);
  assert.equal(resp.data.providers.go, null);
  assert.ok(!alarms.includes("badge-cycle")); // 无可显示项 → 清理循环闹钟
});

test("阈值提醒：≥95% 触发通知，6 小时冷却内不重复", async () => {
  glmH5Pct = 97;
  store.providers = {
    glm: { enabled: true, apiKey: "glm-key", planExpiry: "" },
    go: { enabled: false, apiKey: "" },
  };
  store.notify = true;
  store.notifyCool = {};
  notifyCalls.length = 0;

  await send({ type: "refresh" });
  assert.equal(notifyCalls.length, 1);
  assert.match(notifyCalls[0].title, /智谱 GLM 5 小时额度已用 97%/);
  assert.match(notifyCalls[0].iconUrl, /icon128\.png$/);
  assert.ok(store.notifyCool["glm.h5"] > 0);

  // 冷却期内再刷：不重复提醒
  await send({ type: "refresh" });
  assert.equal(notifyCalls.length, 1);

  // 低于阈值：不提醒，且清除测试钩子
  glmH5Pct = 50;
  store.notifyCool = {};
  notifyCalls.length = 0;
  await send({ type: "refresh" });
  assert.equal(notifyCalls.length, 0);

  glmH5Pct = null;
  store.notify = false;
});
