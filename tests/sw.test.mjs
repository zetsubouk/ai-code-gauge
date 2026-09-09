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
    onAlarm: { addListener: (cb) => { captured.alarm = cb; } },
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
let glmCalls = 0; // GLM 拉取次数（并发守卫测试用）
let glmGate = null; // 置为 promise 时挂起 GLM 响应，制造并发窗口
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("bigmodel.cn")) {
    glmCalls++;
    if (glmGate) await glmGate;
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
  // SW 内的徽章轮换 setInterval 会挂在事件循环上（多模块实例后无人清理），
  // 统一 unref 使其不阻止测试进程退出；用例内需要推进时显式调用闹钟回调。
  const origSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const t = origSetInterval(...args);
    t.unref?.();
    return t;
  };
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

test("故障隔离：GLM 失败不影响 Go；GLM 降级保留上次成功数据并标记 stale", async () => {
  glmMode = "auth_error"; goMode = "ok";
  // 显式预置上一次成功快照，验证失败时降级保留而非清空
  store.lastData = {
    fetchedAt: 1757000000000,
    providers: {
      glm: { level: "lite", levelName: "Lite", planExpiry: "", fetchedAt: 1757000000000, limits: [structuredClone(GLM_OK.data.limits[0])] },
      go: null,
    },
    errors: [],
  };
  store.history = {};
  badge.texts = []; badge.colors = [];
  const resp = await send({ type: "refresh" });
  assert.equal(resp.ok, false);
  assert.equal(resp.reason, "partial");
  assert.equal(resp.data.errors.length, 1);
  assert.equal(resp.data.errors[0].provider, "glm");
  assert.equal(resp.data.errors[0].kind, "invalid_key");

  // 降级而非清空：旧数据保留，标记 stale 且数据时间仍为上次成功拉取
  const glm = resp.data.providers.glm;
  assert.equal(glm.stale, true);
  assert.equal(glm.fetchedAt, 1757000000000);
  assert.equal(glm.limits.length, 1);
  assert.equal(glm.limits[0].percentage, 20);
  // Go 正常拉取，不受影响
  assert.equal(resp.data.providers.go.windows[0].percent, 30);
  assert.equal(resp.data.providers.go.stale, undefined);

  // 徽章只剩 Go 一项（徽章反映本次刷新结果）：不循环，单条显示
  assert.deepEqual(store.badgeItems.map((i) => i.pct), [30]);
  assert.equal(badge.texts.at(-1), "30%");

  // stale 数据不写入当日历史快照（glm 无记录，go 正常记录）
  assert.equal(Object.keys(store.history.glm || {}).length, 0);
  assert.ok(store.history.go.rolling);
});

test("GLM 失败且无上次数据：维持空额度占位（原行为）", async () => {
  glmMode = "auth_error"; goMode = "ok";
  delete store.lastData;
  const resp = await send({ type: "refresh" });
  const glm = resp.data.providers.glm;
  assert.deepEqual(glm.limits, []);
  assert.equal(glm.stale, undefined);
  assert.equal(resp.data.providers.go.windows.length, 3);
});

test("并发守卫：同时触发的 refresh 复用同一次执行", async () => {
  glmMode = "ok"; goMode = "ok";
  glmCalls = 0;
  let release;
  glmGate = new Promise((r) => { release = r; });
  const p1 = send({ type: "refresh" });
  const p2 = send({ type: "refresh" });
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  glmGate = null;
  assert.equal(glmCalls, 1); // GLM 只拉取一次
  assert.equal(r1.data.fetchedAt, r2.data.fetchedAt); // 两个消息拿到同一份快照
});

test("徽章循环：interval 存活时闹钟不推进；SW 冷启动（模块重启）后由闹钟恢复推进", async () => {
  glmMode = "ok"; goMode = "ok";
  store.providers = {
    glm: { enabled: true, apiKey: "glm-key", planExpiry: "" },
    go: { enabled: true, apiKey: "go-key" },
  };
  badge.texts = []; badge.colors = [];
  await send({ type: "refresh" });
  assert.deepEqual(store.badgeItems.map((i) => i.pct), [20, 30]);
  const textsLen = badge.texts.length; // 末条为 items[0] 的 "20%"

  // SW 存活（interval 在跑）：闹钟触发不推进，避免同刻重复跳格
  await captured.alarm({ name: "badge-cycle" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(badge.texts.length, textsLen);

  // 模拟 SW 挂起重启：带查询串重新 import 得到 cycleTimer 为 null 的新模块实例
  await import("../background/service-worker.js?cold-start");
  const n = badge.texts.length;
  await captured.alarm({ name: "badge-cycle" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(badge.texts.length, n + 1); // 冷启动补推一次
  assert.equal(badge.texts.at(-1), "30%"); // badgeIdx 从 0 推进到下一项
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

test("阈值提醒：stale 降级数据不触发通知", async () => {
  glmMode = "auth_error"; goMode = "ok";
  store.notify = true;
  store.notifyCool = {};
  notifyCalls.length = 0;
  // 上次成功数据已 ≥95%，但本次拉取失败 → 复用为 stale，不据此提醒
  store.lastData = {
    fetchedAt: 1757000000000,
    providers: {
      glm: {
        level: "lite", levelName: "Lite", planExpiry: "", fetchedAt: 1757000000000,
        limits: [{ type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 100, currentValue: 97, remaining: 3, percentage: 97, nextResetTime: 1000 }],
      },
      go: null,
    },
    errors: [],
  };
  await send({ type: "refresh" });
  assert.equal(notifyCalls.length, 0);
  store.notify = false;
  delete store.lastData;
});
