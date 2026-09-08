// 背景 service worker：定时拉取各供应商官方接口、更新徽章（双供应商可配置循环切换）、缓存数据供弹窗读取。
// 密钥只存本机 chrome.storage.local，仅用于向各供应商官方接口鉴权。

import { fetchQuotaLimit } from "../shared/api.js";
import { LEVEL_NAMES, describeLimit, classifyWindow, THRESHOLDS } from "../shared/constants.js";
import { fetchGoUsage } from "../shared/go.js";
import { pctColor, badgeText, clampPct, fmtDate } from "../shared/format.js";
import { upsertDay } from "../shared/history.js";

const DEFAULTS = {
  providers: {
    glm: { enabled: true, apiKey: "", planExpiry: "" },
    go: { enabled: false, apiKey: "" },
  },
  refreshMin: 10,
  badgeCycleSec: 10, // 双供应商图标百分比循环间隔（秒）
  lastData: null,
  lastFetchAt: 0,
};

const LEGACY_KEYS = ["apiKey", "planExpiry"];

async function getSettings() {
  const got = await chrome.storage.local.get(["providers", "refreshMin", "badgeCycleSec", "notify", ...LEGACY_KEYS]);
  let providers = got.providers;
  if (!providers) {
    providers = {
      glm: { enabled: true, apiKey: got.apiKey || "", planExpiry: got.planExpiry || "" },
      go: { enabled: false, apiKey: "" },
    };
  }
  const glm = { enabled: true, apiKey: "", planExpiry: "", ...(providers.glm || {}) };
  const go = { enabled: false, apiKey: "", ...(providers.go || {}) };
  // 与设置下拉框、README 口径一致：仅接受 5–60 秒
  const badgeCycleSec = Math.max(5, Math.min(60, Number(got.badgeCycleSec) || DEFAULTS.badgeCycleSec));
  return {
    refreshMin: Number(got.refreshMin) || DEFAULTS.refreshMin,
    badgeCycleSec,
    notify: got.notify === true,
    providers: { glm, go },
  };
}

/* ---------- GLM：仅拉取额度（已按需求移除 24h 模型/工具用量） ---------- */
async function fetchGlm(glmCfg) {
  const quota = await fetchQuotaLimit(glmCfg.apiKey);
  const limits = (quota.limits || []).slice()
    .sort((a, b) => (a.nextResetTime || 0) - (b.nextResetTime || 0))
    .map((l) => ({ ...l, name: describeLimit(l) }));
  return {
    level: quota.level || "unknown",
    levelName: LEVEL_NAMES[quota.level] || quota.level,
    planExpiry: glmCfg.planExpiry,
    limits,
  };
}

/* ---------- 徽章：单行大字号；双供应商循环切换 ---------- */
function glmHeadlinePct(glmData) {
  const credit = (glmData && glmData.limits || []).find((l) => l.type === "CREDIT_LIMIT");
  if (!credit) return null;
  const p = Number(credit.percentage);
  if (Number.isNaN(p)) return null;
  return clampPct(p);
}

async function restoreBrandIcon() {
  // MV3：setIcon({path}) 相对 service worker 目录解析，SW 在 background/ 下，需 ../icons/...
  await chrome.action.setIcon({
    path: { 16: "../icons/icon16.png", 32: "../icons/icon32.png", 48: "../icons/icon48.png", 128: "../icons/icon128.png" },
  }).catch(() => {});
}

async function setBadgeItem(item) {
  await chrome.action.setBadgeBackgroundColor({ color: pctColor(item.pct) });
  await chrome.action.setBadgeText({ text: badgeText(item.pct) });
}

async function clearBadge() {
  await chrome.action.setBadgeText({ text: "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#2E7D32" });
}

let cycleTimer = null;
function clearCycleTimer() { if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null; } }

async function cycleOnce() {
  const got = await chrome.storage.local.get(["badgeItems", "badgeIdx"]);
  const items = got.badgeItems || [];
  if (!items.length) {
    await clearBadge();
    clearCycleTimer();
    await chrome.alarms.clear("badge-cycle");
    return;
  }
  const idx = ((got.badgeIdx || 0) + 1) % items.length;
  await setBadgeItem(items[idx]);
  await chrome.storage.local.set({ badgeIdx: idx });
}

// 定时器 + 闹钟（>=30s 保底）：SW 存活时按用户秒数轮换；SW 挂起后由闹钟续醒恢复
async function startBadgeCycling(items, sec) {
  await chrome.storage.local.set({ badgeItems: items, badgeIdx: 0 });
  clearCycleTimer();
  if (items.length <= 1) {
    await chrome.alarms.clear("badge-cycle");
    return;
  }
  await chrome.alarms.create("badge-cycle", { periodInMinutes: Math.max(0.5, sec / 60) });
  cycleTimer = setInterval(cycleOnce, sec * 1000);
}

async function restartCycleTimer() {
  clearCycleTimer();
  const { badgeCycleSec } = await getSettings();
  const got = await chrome.storage.local.get(["badgeItems"]);
  if ((got.badgeItems || []).length > 1) cycleTimer = setInterval(cycleOnce, badgeCycleSec * 1000);
}

// lines = [{provider, pct}] 按 GLM→Go 顺序
async function setActionIndicator(lines) {
  await restoreBrandIcon();
  if (!lines.length) {
    await clearBadge();
    clearCycleTimer();
    await chrome.alarms.clear("badge-cycle");
    return;
  }
  const items = lines.map((l) => ({ pct: l.pct }));
  const { badgeCycleSec } = await getSettings();
  await startBadgeCycling(items, badgeCycleSec);
  await setBadgeItem(items[0]);
}

/* ---------- 历史：每日快照（按天去重、有界保留） ---------- */
async function recordHistories(snapshot) {
  const day = fmtDate(Date.now());
  const { history } = await chrome.storage.local.get(["history"]);
  const h = history && typeof history === "object" ? history : {};
  h.glm = h.glm || {};
  h.go = h.go || {};
  let changed = false;

  const glm = snapshot.providers.glm;
  if (glm && Array.isArray(glm.limits)) {
    for (const key of ["h5", "weekly"]) {
      const l = glm.limits.find((x) => classifyWindow(x) === key);
      if (l) {
        h.glm[key] = upsertDay(h.glm[key], day, l.percentage);
        changed = true;
      }
    }
  }
  const go = snapshot.providers.go;
  if (go && Array.isArray(go.windows)) {
    for (const w of go.windows) {
      h.go[w.key] = upsertDay(h.go[w.key], day, w.percent);
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ history: h });
}

/* ---------- 阈值提醒：≥bad 触发系统通知，同窗口 6 小时冷却 ---------- */
const NOTIFY_COOLDOWN_MS = 6 * 3600 * 1000;

async function checkNotify(snapshot) {
  const items = [];
  const glm = snapshot.providers.glm;
  if (glm && Array.isArray(glm.limits)) {
    for (const key of ["h5", "weekly"]) {
      const l = glm.limits.find((x) => classifyWindow(x) === key);
      if (l && Number(l.percentage) >= THRESHOLDS.bad) {
        items.push({
          key: `glm.${key}`,
          title: `智谱 GLM ${key === "h5" ? "5 小时" : "每周"}额度已用 ${Math.round(Number(l.percentage))}%`,
        });
      }
    }
  }
  const go = snapshot.providers.go;
  if (go && Array.isArray(go.windows)) {
    for (const w of go.windows) {
      if (Number(w.percent) >= THRESHOLDS.bad) {
        items.push({ key: `go.${w.key}`, title: `OpenCode Go ${w.name}额度已用 ${Math.round(Number(w.percent))}%` });
      }
    }
  }
  if (!items.length) return;

  const { notifyCool } = await chrome.storage.local.get(["notifyCool"]);
  const cool = notifyCool && typeof notifyCool === "object" ? notifyCool : {};
  const now = Date.now();
  for (const it of items) {
    if (cool[it.key] && now - cool[it.key] < NOTIFY_COOLDOWN_MS) continue;
    cool[it.key] = now;
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon128.png"),
        title: it.title,
        message: "额度即将耗尽，注意安排使用节奏。",
      });
    } catch {
      // 通知失败不影响刷新与缓存
    }
  }
  await chrome.storage.local.set({ notifyCool: cool });
}

async function refresh() {
  const { providers, badgeCycleSec, notify } = await getSettings();
  const lines = [];
  const errors = [];
  const snapshot = { fetchedAt: Date.now(), providers: { glm: null, go: null }, errors };

  const glmCfg = providers.glm;
  if (glmCfg.enabled && glmCfg.apiKey) {
    try {
      const glmData = await fetchGlm(glmCfg);
      snapshot.providers.glm = glmData;
      const pct = glmHeadlinePct(glmData);
      if (pct !== null) lines.push({ provider: "glm", pct });
    } catch (e) {
      errors.push({ provider: "glm", message: e.message || String(e), kind: e.kind });
      snapshot.providers.glm = { level: "unknown", levelName: "unknown", planExpiry: glmCfg.planExpiry, limits: [] };
    }
  }

  const goCfg = providers.go;
  if (goCfg.enabled && goCfg.apiKey) {
    try {
      const goData = await fetchGoUsage(goCfg.apiKey);
      snapshot.providers.go = goData;
      const rolling = (goData.windows || []).find((w) => w.key === "rolling");
      if (rolling) lines.push({ provider: "go", pct: clampPct(rolling.percent) });
    } catch (e) {
      errors.push({ provider: "go", message: e.message || String(e), kind: e.kind });
      snapshot.providers.go = { error: true, message: e.message || String(e) };
    }
  }

  await setActionIndicator(lines);

  await persistSnapshot(snapshot);
  await recordHistories(snapshot);
  if (notify) await checkNotify(snapshot);
  const ok = errors.length === 0;
  return { ok, reason: ok ? "ok" : (lines.length ? "partial" : "error"), data: snapshot };
}

function persistSnapshot(snap) {
  return chrome.storage.local.set({ lastData: snap, lastFetchAt: Date.now() });
}

async function ensureAlarm() {
  const { refreshMin } = await getSettings();
  const period = Math.min(30, Math.max(1, refreshMin || 10));
  await chrome.alarms.clear("glm-refresh");
  await chrome.alarms.create("glm-refresh", { periodInMinutes: period });
  return period;
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm().then(() => refresh()); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm().then(() => refresh()); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "glm-refresh") refresh();
  else if (alarm.name === "badge-cycle") { restartCycleTimer(); cycleOnce(); }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg?.type) {
        case "refresh":
          return sendResponse(await refresh());
        case "getData": {
          const got = await chrome.storage.local.get(["lastData", "lastFetchAt", "providers", "badgeCycleSec"]);
          return sendResponse({ data: got.lastData || null, fetchedAt: got.lastFetchAt || 0, providers: got.providers || null, badgeCycleSec: got.badgeCycleSec || null });
        }
        case "settingsChanged":
          await ensureAlarm();
          return sendResponse(await refresh());
        default:
          return sendResponse({ ok: false, reason: "unknown" });
      }
    } catch (e) {
      console.error("[ai-code-gauge] 后台处理消息出错:", e);
      return sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();
  return true;
});