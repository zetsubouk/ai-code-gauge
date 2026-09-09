// 背景 service worker：定时拉取各供应商官方接口、更新徽章（双供应商可配置循环切换）、缓存数据供弹窗读取。
// 供应商差异全部收敛在 shared/providers.js 注册表，这里只保留通用的刷新/降级/历史/提醒循环。
// 密钥只存本机 chrome.storage.local，仅用于向各供应商官方接口鉴权。

import { PROVIDERS, orderedProviders } from "../shared/providers.js";
import { pctColor, badgeText, fmtDate } from "../shared/format.js";
import { upsertDay } from "../shared/history.js";

const DEFAULTS = {
  refreshMin: 10,
  badgeCycleSec: 10, // 双供应商图标百分比循环间隔（秒）
  lastData: null,
  lastFetchAt: 0,
};

const LEGACY_KEYS = ["apiKey", "planExpiry"];

async function getSettings() {
  const got = await chrome.storage.local.get(["providers", "providerOrder", "refreshMin", "badgeCycleSec", "notify", ...LEGACY_KEYS]);
  let stored = got.providers;
  if (!stored) {
    // 旧版单供应商配置迁移：apiKey/planExpiry 归入 GLM
    stored = { glm: { apiKey: got.apiKey || "", planExpiry: got.planExpiry || "" } };
  }
  const providers = {};
  for (const p of PROVIDERS) providers[p.id] = { ...p.defaults, ...(stored[p.id] || {}) };
  // 与设置下拉框、README 口径一致：仅接受 5–60 秒
  const badgeCycleSec = Math.max(5, Math.min(60, Number(got.badgeCycleSec) || DEFAULTS.badgeCycleSec));
  return {
    refreshMin: Number(got.refreshMin) || DEFAULTS.refreshMin,
    badgeCycleSec,
    notify: got.notify === true,
    providers,
    providerOrder: orderedProviders(got.providerOrder).map((p) => p.id),
  };
}

/* ---------- 徽章：单行大字号；双供应商循环切换 ---------- */
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

// interval 主驱动：SW 存活时按用户秒数轮换；闹钟（Chrome 最小周期 30s）仅作 SW 挂起后的冷启动保底（见 onAlarm）
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

// lines = [{provider, pct}] 按注册表顺序（GLM→Go）
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
  // stale 是拉取失败时复用的上次成功数据，不代表当日用量，跳过不写快照
  const day = fmtDate(Date.now());
  const { history } = await chrome.storage.local.get(["history"]);
  const h = history && typeof history === "object" ? history : {};
  let changed = false;

  for (const p of PROVIDERS) {
    const data = snapshot.providers[p.id];
    if (!(data && !data.stale)) continue;
    h[p.id] = h[p.id] || {};
    for (const { key, pct, raw } of p.historyEntries(data)) {
      h[p.id][key] = upsertDay(h[p.id][key], day, pct, { raw: Boolean(raw) });
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ history: h });
}

/* ---------- 阈值提醒：≥bad 触发系统通知，同窗口 6 小时冷却 ---------- */
const NOTIFY_COOLDOWN_MS = 6 * 3600 * 1000;

async function checkNotify(snapshot) {
  const items = [];
  // stale 数据可能已过时，不据此触发提醒
  for (const p of PROVIDERS) {
    const data = snapshot.providers[p.id];
    if (!(data && !data.stale)) continue;
    for (const it of p.notifyItems(data)) {
      items.push({ key: `${p.id}.${it.key}`, title: `${p.name} ${it.title}` });
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

/* ---------- 余额型供应商：按日账本，推导今日消耗 ---------- */
// 每天首刷记录「今日起点余额」，之后 spentToday = 起点 - 当前；余额回升（充值）则重置起点。
// 数据随快照下发（spentToday/dayStart），徽章、历史与面板共用。
async function deriveBalance(providerId, data) {
  const day = fmtDate(Date.now());
  const { balanceLedger } = await chrome.storage.local.get(["balanceLedger"]);
  const led = balanceLedger && typeof balanceLedger === "object" ? balanceLedger : {};
  let entry = led[providerId];
  if (!entry || entry.day !== day || typeof entry.start !== "number" || data.total > entry.start) {
    entry = { day, start: data.total };
  }
  const spentToday = Math.max(0, Math.round((entry.start - data.total) * 100) / 100);
  led[providerId] = entry;
  await chrome.storage.local.set({ balanceLedger: led });
  return { ...data, spentToday, dayStart: entry.start };
}

async function runRefresh() {
  const { providers, providerOrder, notify } = await getSettings();
  const ordered = orderedProviders(providerOrder);
  // 上一份快照：某供应商拉取失败时用于降级保留其上次成功数据
  const { lastData: prev } = await chrome.storage.local.get(["lastData"]);
  const prevProviders = (prev && prev.providers) || {};
  const lines = [];
  const errors = [];
  const snapshot = { fetchedAt: Date.now(), providers: Object.fromEntries(ordered.map((p) => [p.id, null])), errors };

  for (const p of ordered) {
    const cfg = providers[p.id];
    if (!(cfg && cfg.enabled && cfg.apiKey)) continue;
    try {
      let data = await p.fetchUsage(cfg);
      if (p.mode === "balance") data = await deriveBalance(p.id, data);
      // fetchedAt 记录该供应商数据的实际拉取时间，供降级展示时标注数据新旧
      snapshot.providers[p.id] = { ...data, fetchedAt: snapshot.fetchedAt };
      const pct = p.headlinePct(data);
      if (pct !== null) lines.push({ provider: p.id, pct });
    } catch (e) {
      errors.push({ provider: p.id, message: e.message || String(e), kind: e.kind });
      // 降级而非清空：上次成功数据可用则复用并标记 stale，弹窗据此提示「显示的是旧数据」
      const prevData = prevProviders[p.id];
      snapshot.providers[p.id] = p.hasUsage(prevData)
        ? { ...p.applyConfig(prevData, cfg), stale: true }
        : p.emptyData(cfg, e);
    }
  }

  await setActionIndicator(lines);

  await persistSnapshot(snapshot);
  await recordHistories(snapshot);
  if (notify) await checkNotify(snapshot);
  const ok = errors.length === 0;
  return { ok, reason: ok ? "ok" : (lines.length ? "partial" : "error"), data: snapshot };
}

// 并发守卫：弹窗消息与定时闹钟可能同时请求刷新，进行中则复用同一次执行，
// 避免重复网络请求与 lastData/history/badgeItems 的竞态写入
let refreshInFlight = null;
function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

function persistSnapshot(snap) {
  return chrome.storage.local.set({ lastData: snap, lastFetchAt: Date.now() });
}

async function ensureAlarm() {
  const { refreshMin } = await getSettings();
  const period = Math.min(30, Math.max(1, refreshMin || 10));
  await chrome.alarms.clear("glm-refresh"); // 名称沿用历史，改动会造成旧安装残留重复闹钟
  await chrome.alarms.create("glm-refresh", { periodInMinutes: period });
  return period;
}

chrome.runtime.onInstalled.addListener(() => { ensureAlarm().then(() => refresh()); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm().then(() => refresh()); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "glm-refresh") refresh();
  // 徽章循环仅冷启动续醒：SW 存活时 interval 在跑，这里不动，避免与 interval 同刻重复推进；
  // SW 挂起唤醒（cycleTimer 随模块消失为 null）时才恢复定时器并补推一次
  else if (alarm.name === "badge-cycle" && !cycleTimer) restartCycleTimer().then(cycleOnce);
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
