// 弹窗逻辑：渲染多供应商用量（GLM 智谱大陆 / OpenCode Go），额度卡片分段展示（用量一行、重置时间独立一行）；
// 每次打开强刷；错误显式暴露。

import { nf, fmtTime, fmtRemain, pctColor, pctState, clampPct, daysLeft, fmtDate } from "../shared/format.js";
import { LEVEL_NAMES, classifyWindow, THRESHOLDS } from "../shared/constants.js";
import { PROVIDER_MAP, orderedProviders } from "../shared/providers.js";
import { lastDays, describeTrend } from "../shared/history.js";
import { validateSettingsImport } from "../shared/io.js";

const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"), panel: $("panel"), provList: $("prov-list"),
  glmOn: $("f-glm-on"), glmKey: $("f-glm-key"), glmExpiry: $("f-glm-expiry"),
  goOn: $("f-go-on"), goKey: $("f-go-key"),
  dsOn: $("f-ds-on"), dsKey: $("f-ds-key"),
  fRefresh: $("f-refresh"), fCycle: $("f-cycle"), fNotify: $("f-notify"), btnSave: $("btn-save"), setupMsg: $("setup-msg"),
  btnExport: $("btn-export"), btnImport: $("btn-import"), fImport: $("f-import"), fExportKeys: $("f-export-keys"),
  planBadge: $("plan-badge"), planExpiry: $("plan-expiry"), goExpiry: $("go-expiry"), lastUpdated: $("last-updated"),
  statusBar: $("status-bar"), planErr: $("plan-err"),
  panes: $("panes"), paneGlm: $("pane-glm"), paneGo: $("pane-go"), paneDs: $("pane-ds"),
  glmStale: $("glm-stale"), goStale: $("go-stale"), dsStale: $("ds-stale"),
  limits: $("limits"), mcp: $("mcp-wrap"), goLimits: $("go-limits"),
  dsCards: $("ds-cards"), dsState: $("ds-state"),
  btnSettings: $("btn-settings"), btnRefresh: $("btn-refresh"),
  glmOpen: $("btn-glm-open"), goOpen: $("btn-go-open"), dsOpen: $("btn-ds-open"),
  footRefresh: $("foot-refresh"),
};

// 面板顺序由设置 providerOrder 决定（分栏排列与徽章循环同源）
async function getOrder() {
  const { providerOrder } = await chrome.storage.local.get(["providerOrder"]);
  return orderedProviders(providerOrder).map((p) => p.id);
}

function shortError(e) { return e && e.message ? e.message : (e || "未知错误"); }

// 刷新失败降级提示：该供应商本次拉取失败，展示的是上次成功数据（stale）
function setStaleNote(el, prov) {
  el.hidden = !(prov && prov.stale);
  if (prov && prov.stale) {
    const at = Number(prov.fetchedAt);
    el.textContent = at
      ? `本次刷新失败，显示 ${fmtTime(at)} 拉取的数据`
      : "本次刷新失败，显示上次成功拉取的数据";
  }
}

/* ---------- 额度卡片构建：动态文本一律 textContent/DOM 构建，仅静态 SVG 图标用 innerHTML ---------- */
const CLOCK_SVG = '<svg class="ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const ACTIVITY_SVG = '<svg class="ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 8-6-16-3 8H2"/></svg>';

// 趋势行数值节点：文本为已格式化字符串，pct 数值仅用于 ≥warn/≥bad 变色（与进度条同口径）
function pctNode(text, pct) {
  const b = document.createElement("b");
  b.textContent = text;
  if (pct >= THRESHOLDS.bad) b.classList.add("bad");
  else if (pct >= THRESHOLDS.warn) b.classList.add("warn");
  return b;
}

// 用量行的一个分段：pre<strong>strong</strong>post
function metaSeg(pre, strong, post = "") {
  const span = document.createElement("span");
  if (pre) span.append(pre);
  if (strong) {
    const b = document.createElement("b");
    b.textContent = strong;
    span.appendChild(b);
  }
  if (post) span.append(post);
  return span;
}

// 卡片结构：名称+数值 / 进度条（带 aria）/ 用量行 / 重置行 / 近 7 日趋势
// value 提供时大数字显示该文本（如 ¥56.21）而非百分比；trend.money 为真时趋势行按金额渲染
function buildCard({ name, pct, value = null, money = false, metaSegs, resetText, trend = null }) {
  const pctInt = Math.round(pct);
  const state = pctState(pct);

  const top = document.createElement("div");
  top.className = "limit-top";
  const nameEl = document.createElement("span");
  nameEl.className = "limit-name";
  nameEl.textContent = name;
  const pctEl = document.createElement("span");
  if (value !== null) {
    pctEl.className = "limit-pct" + (money ? " money" : "") + state;
    pctEl.textContent = value;
  } else {
    pctEl.className = "limit-pct" + state;
    pctEl.append(String(pctInt));
    const small = document.createElement("small");
    small.textContent = "%";
    pctEl.appendChild(small);
  }
  top.append(nameEl, pctEl);

  const track = document.createElement("div");
  track.className = "limit-track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(pctInt));
  track.setAttribute("aria-label", `${name}已用 ${pctInt}%`);
  const fill = document.createElement("div");
  fill.className = "limit-fill" + state;
  fill.style.width = pct + "%";
  track.appendChild(fill);

  const meta = document.createElement("div");
  meta.className = "limit-meta";
  metaSegs.forEach((seg, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "·";
      meta.appendChild(sep);
    }
    meta.appendChild(seg);
  });

  const reset = document.createElement("div");
  reset.className = "limit-reset";
  reset.innerHTML = CLOCK_SVG; // 静态图标常量
  const resetTextEl = document.createElement("span");
  resetTextEl.textContent = resetText;
  reset.appendChild(resetTextEl);

  const el = document.createElement("div");
  el.className = "limit";
  el.append(top, track, meta, reset);

  // 近 N 日趋势文字行（与重置行同构；无数据时整行隐藏）；money 模式按金额渲染（数值单位为分）
  if (trend) {
    const trendEl = document.createElement("div");
    trendEl.className = "limit-trend";
    trendEl.setAttribute("aria-hidden", "true");
    trendEl.innerHTML = ACTIVITY_SVG; // 静态图标常量
    const text = document.createElement("span");
    const unitText = (v) => (trend.money ? `¥${(v / 100).toFixed(2)}` : `${v}%`);
    const colorPct = trend.money ? trend.colorPct : trend.today;
    if (trend.avg === null) {
      text.append("今日 ");
      text.appendChild(pctNode(unitText(trend.today), colorPct));
      text.append("（首日记录）");
    } else {
      text.append(`近 ${trend.days} 日日均 `);
      const avg = document.createElement("b");
      avg.textContent = unitText(trend.avg);
      text.appendChild(avg);
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "·";
      text.appendChild(sep);
      text.append("今日 ");
      text.appendChild(pctNode(unitText(trend.today), colorPct));
    }
    trendEl.appendChild(text);
    el.appendChild(trendEl);
  }
  return el;
}

/* ---------- GLM 额度卡片 ---------- */
function limitBar(limit, label, trend) {
  const pct = clampPct(limit.percentage);
  const used = Number(limit.currentValue || 0);
  const total = Number(limit.usage || 0);
  const remaining = limit.remaining;

  // 用量行：已用/总额/剩余聚合为一行，重置时间独立一行弱化展示
  const metaSegs = [];
  if (total && used) metaSegs.push(metaSeg("已用 ", nf(used), ` / ${nf(total)} 积分`));
  else if (used) metaSegs.push(metaSeg("已用 ", nf(used)));
  if (remaining !== undefined && remaining !== null) metaSegs.push(metaSeg("剩余 ", nf(remaining)));

  const resetText = limit.nextResetTime
    ? `${fmtRemain(limit.nextResetTime - Date.now())}后重置`
    : "";
  return buildCard({ name: label, pct, metaSegs, resetText, trend: describeTrend(trend) });
}

/* ---------- OpenCode Go 额度卡片（与 GLM 同构） ---------- */
function goBar(w, trend) {
  const pct = clampPct(w.percent);
  // Go 接口仅返回百分比，用量行展示已知档位的参考限额
  const metaSegs = w.limit ? [metaSeg("参考限额 ", `$${w.limit}`)] : [];
  const resetText = w.endTs
    ? `${fmtRemain(w.endTs - Date.now())}后重置`
    : "";
  return buildCard({ name: w.name, pct, metaSegs, resetText, trend: describeTrend(trend) });
}

/* ---------- MCP ---------- */
function renderMcp(limits, container) {
  container.textContent = "";
  const others = limits.filter((l) => classifyWindow(l) === "other");
  for (const o of others) {
    const pct = clampPct(o.percentage);
    const total = Number(o.usage || 0);
    const row = document.createElement("div");
    row.className = "mcp-row";
    const left = document.createElement("span");
    left.className = "l";
    left.textContent = `${o.name || "MCP"}${total ? ` · ${Math.round(pct)}%` : ""}`;
    const right = document.createElement("span");
    right.className = "v";
    const used = document.createElement("b");
    used.style.color = pctColor(pct);
    used.textContent = nf(o.currentValue);
    right.append(used, ` / ${nf(total || "—")} 次`);
    row.append(left, right);
    container.appendChild(row);
  }
}

/* ---------- DeepSeek（余额型面板） ---------- */
const fmtMoney = (n) => `¥${Number(n).toFixed(2)}`;
const fmtDays = (n) => (n < 1 ? "不足 1" : n >= 99 ? "99+" : String(Math.round(n)));

// 近 7 日余额序列（单位分）→ 相邻记录日的日消耗（余额下降差值，充值日照跳过）
function dailySpends(cents) {
  const out = [];
  for (let i = 1; i < cents.length; i++) {
    const d = cents[i - 1].p - cents[i].p;
    if (d > 0) out.push(d);
  }
  return out;
}

function renderDs(ds, histDs) {
  els.dsCards.textContent = "";
  els.dsState.className = "state-pill " + (ds.isAvailable ? "ok" : "bad");
  els.dsState.textContent = ds.isAvailable ? "可用" : "余额不足";
  if (ds.error || typeof ds.total !== "number") {
    els.dsCards.innerHTML = `<div class="empty">DeepSeek 无余额数据。</div>`;
    return;
  }

  const days = lastDays(histDs && histDs.balance, 7); // 余额序列，单位分
  const spends = dailySpends(days); // 日消耗序列，单位分
  const avgDailyCents = spends.length ? spends.reduce((a, b) => a + b, 0) / spends.length : null;
  const avgDaily = avgDailyCents === null ? null : avgDailyCents / 100;
  const spent = typeof ds.spentToday === "number" ? ds.spentToday : 0;
  const dayStart = typeof ds.dayStart === "number" && ds.dayStart > 0 ? ds.dayStart : ds.total;

  // 卡 1：账户余额（进度条为赠金占比，纯构成展示）
  els.dsCards.appendChild(buildCard({
    name: "账户余额", pct: ds.total > 0 ? clampPct((ds.granted / ds.total) * 100) : 0,
    value: fmtMoney(ds.total), money: true,
    metaSegs: [metaSeg("充值 ", fmtMoney(ds.toppedUp)), metaSeg("赠金 ", fmtMoney(ds.granted))],
    resetText: "按量付费 · 无重置周期 · 优先扣赠金",
  }));

  // 卡 2：今日消耗（占今日起点比例驱动阈值色；可用天数按近 7 日日均推算）
  const spendPct = clampPct((spent / dayStart) * 100);
  const metaSegs = [metaSeg("占今日起点 ", `${Math.round(spendPct)}%`)];
  if (avgDaily !== null) metaSegs.push(metaSeg("近 7 日日均 ", fmtMoney(avgDaily)));
  els.dsCards.appendChild(buildCard({
    name: "今日消耗", pct: spendPct,
    value: fmtMoney(spent), money: true, metaSegs,
    resetText: avgDaily && avgDaily > 0
      ? `按日均推算可用 ${fmtDays(ds.total / avgDaily)} 天`
      : "积累几日数据后推算可用天数",
    trend: days.length
      ? {
          days: Math.max(spends.length, 1),
          avg: avgDailyCents === null ? null : Math.round(avgDailyCents),
          today: Math.round(spent * 100),
          money: true,
          colorPct: spendPct, // 金额行的变色基准：今日消耗占起点比（与进度条同口径）
        }
      : null,
  }));
}

/* ---------- 顶层渲染 ---------- */
let lastView = null; // 最近一次渲染的数据，供弹窗存活期间的周期重绘使用
function render(payload, history, order) {
  lastView = { payload, history, order };
  if (!payload) {
    els.limits.innerHTML = `<div class="empty">暂无数据，正在刷新…</div>`;
    els.goLimits.innerHTML = "";
    els.dsCards.innerHTML = "";
    return;
  }
  const prov = payload.providers || {};
  const glm = prov.glm;
  const go = prov.go;
  const ds = prov.deepseek;
  // 判定"是否启用/有数据呈现"：glm 启用且非仅 error 占位；go/ds 启用且有数据
  const glmShown = !!(glm && !(glm.error && !glm.limits));
  const goShown = !!(go && !go.error);
  const dsShown = !!(ds && !ds.error);

  // 面板按用户配置顺序排列（grid order）；宽度随呈现数量自适应（1 家窄栏 / ≥2 家双栏）
  const paneById = { glm: els.paneGlm, go: els.paneGo, deepseek: els.paneDs };
  const ordered = orderedProviders(order);
  ordered.forEach((p, i) => {
    const pane = paneById[p.id];
    if (pane) pane.style.order = i;
  });
  const shownCount = [glmShown, goShown, dsShown].filter(Boolean).length;
  document.body.classList.toggle("wide", shownCount >= 2);

  // 头部品牌名静态维护于 HTML；徽章/到期随 GLM 面板标题行展示
  let badge = "";
  if (glmShown && glm) {
    const levelName = (glm.levelName || LEVEL_NAMES[glm.level]) || "";
    if (levelName && levelName !== "unknown") badge = levelName;
  }
  els.planBadge.textContent = badge;
  els.planExpiry.textContent = "";
  els.planExpiry.className = "plan-expiry";
  if (glmShown && glm && glm.planExpiry) {
    els.planExpiry.textContent = `到期 ${glm.planExpiry}`;
    const dl = daysLeft(glm.planExpiry);
    if (dl !== null && dl < 0) { els.planExpiry.classList.add("bad"); els.planExpiry.textContent += "（已到期）"; }
    else if (dl !== null && dl <= 7) { els.planExpiry.classList.add("warn"); els.planExpiry.textContent += `（剩 ${dl} 天）`; }
  }
  // Go 到期：由「每月」窗口重置时间（endTs）推算当月套餐截止日，本地时区取日历日
  els.goExpiry.textContent = "";
  els.goExpiry.className = "plan-expiry";
  if (goShown && go && Array.isArray(go.windows)) {
    const monthly = go.windows.find((w) => w.key === "monthly");
    if (monthly && monthly.endTs) {
      const dateStr = fmtDate(monthly.endTs);
      els.goExpiry.textContent = `到期 ${dateStr}`;
      const dl = daysLeft(dateStr);
      if (dl !== null && dl < 0) { els.goExpiry.classList.add("bad"); els.goExpiry.textContent += "（已到期）"; }
      else if (dl !== null && dl <= 7) { els.goExpiry.classList.add("warn"); els.goExpiry.textContent += `（剩 ${dl} 天）`; }
    }
  }
  // 更新时间按所展示供应商各自的最后成功拉取时间计算：降级展示旧数据时如实反映新旧
  const times = [];
  if (glmShown && Number(glm.fetchedAt)) times.push(Number(glm.fetchedAt));
  if (goShown && Number(go.fetchedAt)) times.push(Number(go.fetchedAt));
  if (dsShown && Number(ds.fetchedAt)) times.push(Number(ds.fetchedAt));
  const shownAt = times.length ? Math.max(...times) : payload.fetchedAt;
  els.lastUpdated.textContent = shownAt ? fmtTime(shownAt) + " 更新" : "";

  // 错误（按来源：GLM 专属条；其余供应商与传输层走通用状态条，带供应商名前缀）
  const errs = payload.errors || [];
  const glmErr = errs.find((e) => e.provider === "glm");
  els.planErr.hidden = !glmErr;
  if (glmErr) els.planErr.textContent = "GLM 用量查询失败：" + shortError(glmErr);
  const otherErrs = errs.filter((e) => e.provider !== "glm");
  els.statusBar.hidden = otherErrs.length === 0;
  if (otherErrs.length) {
    els.statusBar.className = "status" + (otherErrs.some((e) => e.kind === "invalid_key") ? " bad" : "");
    els.statusBar.textContent = otherErrs
      .map((e) => (e.provider !== "transport" && PROVIDER_MAP[e.provider] ? PROVIDER_MAP[e.provider].name + "：" : "") + shortError(e))
      .join("；");
  }

  // 降级提示随面板：仅在该供应商本次拉取失败但保留了上次数据时显示
  setStaleNote(els.glmStale, glmShown ? glm : null);
  setStaleNote(els.goStale, goShown ? go : null);
  setStaleNote(els.dsStale, dsShown ? ds : null);

  // GLM 栏
  els.paneGlm.hidden = !glmShown;
  if (glmShown) {
    const limits = (glm && glm.limits) || [];
    const histGlm = (history && history.glm) || {};
    els.limits.innerHTML = "";
    els.mcp.innerHTML = "";
    if (!limits.length) {
      els.limits.innerHTML = `<div class="empty">未查询到额度。</div>`;
    } else {
      const h5 = limits.find((l) => classifyWindow(l) === "h5");
      const weekly = limits.find((l) => classifyWindow(l) === "weekly");
      if (h5) els.limits.appendChild(limitBar(h5, "5 小时", lastDays(histGlm.h5)));
      if (weekly) els.limits.appendChild(limitBar(weekly, "每周", lastDays(histGlm.weekly)));
      const leftover = limits.filter((l) => classifyWindow(l) === "other");
      if (leftover.length && !h5 && !weekly) els.limits.appendChild(limitBar(leftover[0], leftover[0].name || "额度"));
      renderMcp(leftover || [], els.mcp);
    }
  }

  // Go 栏
  els.paneGo.hidden = !goShown;
  if (goShown) {
    els.goLimits.innerHTML = "";
    const windows = (go && go.windows) || [];
    const histGo = (history && history.go) || {};
    if (!windows.length) {
      els.goLimits.innerHTML = `<div class="empty">OpenCode Go 无用量数据。</div>`;
    } else {
      windows.forEach((w) => els.goLimits.appendChild(goBar(w, lastDays(histGo[w.key]))));
    }
  }

  // DeepSeek 栏
  els.paneDs.hidden = !dsShown;
  if (dsShown) renderDs(ds, (history && history.deepseek) || {});
}

/* ---------- 动作 ---------- */
function setRefreshBusy(b) {
  // 按钮内容为 SVG 图标，旋转动画作用于按钮本身，结束后自动还原
  els.btnRefresh.disabled = b;
  els.btnRefresh.classList.toggle("spin", b);
}

async function doRefresh() {
  setRefreshBusy(true);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "refresh" });
    if (resp && resp.data) {
      const { history, providerOrder } = await chrome.storage.local.get(["history", "providerOrder"]);
      render(resp.data, history, providerOrder);
    }
    else if (resp && resp.error) {
      render({ fetchedAt: Date.now(), providers: {}, errors: [{ provider: "transport", message: "刷新失败：" + resp.error, kind: "server" }] });
    }
  } catch (e) {
    render({ fetchedAt: Date.now(), providers: {}, errors: [{ provider: "transport", message: "刷新失败：" + shortError(e), kind: "network" }] });
  } finally { setRefreshBusy(false); }
}

function showSetup() { els.panel.hidden = true; els.setup.hidden = false; }
function showPanel() { els.setup.hidden = true; els.panel.hidden = false; }

function syncFieldsVisibility() {
  els.glmKey.closest(".prov-fields").hidden = !els.glmOn.checked;
  els.goKey.closest(".prov-fields").hidden = !els.goOn.checked;
  els.dsKey.closest(".prov-fields").hidden = !els.dsOn.checked;
}

// 设置列表按 providerOrder 排列（移动按钮以此为数据源）
async function syncProvListOrder() {
  const order = await getOrder();
  for (const id of order) {
    const block = els.provList.querySelector(`.prov-block[data-prov="${id}"]`);
    if (block) block.style.order = order.indexOf(id);
  }
}

// ↑↓ 移动：仅重排 DOM 与待保存顺序，保存后生效
async function moveProvider(id, dir) {
  const order = await getOrder();
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  await chrome.storage.local.set({ providerOrder: order });
  await syncProvListOrder();
}

function fillSettings(got) {
  const prov = got.providers || {};
  const glm = prov.glm || {}, go = prov.go || {}, ds = prov.deepseek || {};
  els.glmOn.checked = glm.enabled !== false;
  els.glmKey.value = glm.apiKey || ""; els.glmExpiry.value = glm.planExpiry || "";
  els.goOn.checked = go.enabled === true;
  els.goKey.value = go.apiKey || "";
  els.dsOn.checked = ds.enabled === true;
  els.dsKey.value = ds.apiKey || "";
  syncFieldsVisibility();
  els.fRefresh.value = String(got.refreshMin || 10);
  els.fCycle.value = String(got.badgeCycleSec || 10);
  els.fNotify.checked = got.notify === true;
}

async function init() {
  const got = await chrome.storage.local.get(["lastData", "lastFetchAt", "providers", "providerOrder", "refreshMin", "badgeCycleSec", "notify", "history"]);
  fillSettings(got);
  await syncProvListOrder();
  els.footRefresh.textContent = `每 ${got.refreshMin || 10} 分钟自动刷新`;
  // 弹窗存活期间每 30s 重绘一次，重置倒计时等相对时间保持新鲜；弹窗关闭即销毁，无需清理
  setInterval(() => { if (lastView) render(lastView.payload, lastView.history, lastView.order); }, 30000);

  const prov = got.providers || {};
  const anyEnabled = Object.values(prov).some((p) => p && p.enabled && p.apiKey);
  if (!anyEnabled) { showSetup(); return; }
  showPanel();
  if (got.lastData) render(got.lastData, got.history, got.providerOrder);
  doRefresh();
}

/* ---------- 事件 ---------- */
els.glmOn.addEventListener("change", syncFieldsVisibility);
els.goOn.addEventListener("change", syncFieldsVisibility);
els.dsOn.addEventListener("change", syncFieldsVisibility);
els.btnRefresh.addEventListener("click", doRefresh);
els.btnSettings.addEventListener("click", showSetup);
els.glmOpen.addEventListener("click", () => chrome.tabs.create({ url: PROVIDER_MAP.glm.officialUrl }));
els.goOpen.addEventListener("click", () => chrome.tabs.create({ url: PROVIDER_MAP.go.officialUrl }));
els.dsOpen.addEventListener("click", () => chrome.tabs.create({ url: PROVIDER_MAP.deepseek.officialUrl }));
els.provList.addEventListener("click", (e) => {
  const btn = e.target.closest(".move-btn");
  if (!btn) return;
  e.preventDefault();
  const id = btn.closest(".prov-move").dataset.prov;
  moveProvider(id, btn.dataset.move === "up" ? -1 : 1);
});

els.btnSave.addEventListener("click", async () => {
  const order = await getOrder();
  const providers = {
    glm: {
      enabled: els.glmOn.checked,
      apiKey: els.glmKey.value.trim(),
      planExpiry: els.glmExpiry.value || "",
    },
    go: { enabled: els.goOn.checked, apiKey: els.goKey.value.trim() },
    deepseek: { enabled: els.dsOn.checked, apiKey: els.dsKey.value.trim() },
  };
  // 校验：开启的供应商必须有 key
  const missing = Object.entries(providers)
    .filter(([, p]) => p.enabled && !p.apiKey)
    .map(([id]) => PROVIDER_MAP[id].name);
  if (missing.length) { show("请补充必填项：\n· " + missing.map((n) => `${n} 未填 API Key`).join("\n· "), false); return; }
  if (providers.glm.planExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(providers.glm.planExpiry)) {
    show("GLM 到期日期格式应为 YYYY-MM-DD。", false); return;
  }
  const refreshMin = Number(els.fRefresh.value) || 10;
  const badgeCycleSec = Number(els.fCycle.value) || 10;
  const notify = els.fNotify.checked;
  await chrome.storage.local.set({ providers, providerOrder: order, refreshMin, badgeCycleSec, notify });
  show("已保存，正在查询…", true);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "settingsChanged" });
    if (!resp) throw new Error("后台无响应");
    const errs = (resp.data && resp.data.errors) || [];
    const named = errs.find((e) => e.kind === "invalid_key" && PROVIDER_MAP[e.provider]);
    if (named) { show(`${PROVIDER_MAP[named.provider].name} API Key 校验失败：` + shortError(named), false); return; }
    if (resp.data) {
      const { history } = await chrome.storage.local.get(["history"]);
      render(resp.data, history, order);
    }
    showPanel();
  } catch (e) {
    show("保存成功，查询未完成（" + shortError(e) + "）", false);
    showPanel();
  }
});

function show(msg, ok) {
  els.setupMsg.hidden = false;
  els.setupMsg.className = "msg " + (ok ? "ok" : "bad");
  els.setupMsg.textContent = msg;
}

/* ---------- 配置导出/导入 ---------- */
async function doExport() {
  try {
    const got = await chrome.storage.local.get(["providers", "providerOrder", "refreshMin", "badgeCycleSec", "notify"]);
    const prov = got.providers || {};
    const includeKeys = els.fExportKeys.checked;
    const data = {
      app: "ai-code-gauge",
      exportedAt: new Date().toISOString(),
      settings: {
        providers: {
          glm: {
            enabled: prov.glm?.enabled !== false,
            planExpiry: prov.glm?.planExpiry || "",
            apiKey: includeKeys ? (prov.glm?.apiKey || "") : "",
          },
          go: {
            enabled: prov.go?.enabled === true,
            apiKey: includeKeys ? (prov.go?.apiKey || "") : "",
          },
          deepseek: {
            enabled: prov.deepseek?.enabled === true,
            apiKey: includeKeys ? (prov.deepseek?.apiKey || "") : "",
          },
        },
        providerOrder: await getOrder(),
        refreshMin: got.refreshMin || 10,
        badgeCycleSec: got.badgeCycleSec || 10,
        notify: got.notify === true,
      },
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-code-gauge-config-${fmtDate(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    show(includeKeys ? "已导出（含 API Key，注意保管）" : "已导出（不含 API Key）", true);
  } catch (e) {
    show("导出失败：" + shortError(e), false);
  }
}

async function doImport() {
  const file = els.fImport.files && els.fImport.files[0];
  els.fImport.value = ""; // 允许重复选择同一文件
  if (!file) return;
  try {
    const s = validateSettingsImport(JSON.parse(await file.text()));
    // 空 apiKey 视为「保留现有密钥」
    const cur = (await chrome.storage.local.get(["providers"])).providers || {};
    const providers = {
      glm: {
        enabled: s.providers.glm.enabled,
        planExpiry: s.providers.glm.planExpiry,
        apiKey: s.providers.glm.apiKey || (cur.glm && cur.glm.apiKey) || "",
      },
      go: {
        enabled: s.providers.go.enabled,
        apiKey: s.providers.go.apiKey || (cur.go && cur.go.apiKey) || "",
      },
      deepseek: {
        enabled: s.providers.deepseek.enabled,
        apiKey: s.providers.deepseek.apiKey || (cur.deepseek && cur.deepseek.apiKey) || "",
      },
    };
    await chrome.storage.local.set({
      providers,
      providerOrder: s.providerOrder,
      refreshMin: s.refreshMin,
      badgeCycleSec: s.badgeCycleSec,
      notify: s.notify,
    });
    fillSettings(await chrome.storage.local.get(["providers", "refreshMin", "badgeCycleSec", "notify"]));
    await syncProvListOrder();
    show("已导入，正在查询…", true);
    const resp = await chrome.runtime.sendMessage({ type: "settingsChanged" });
    if (resp && resp.data) {
      const { history } = await chrome.storage.local.get(["history"]);
      render(resp.data, history, s.providerOrder);
    }
    showPanel();
  } catch (e) {
    show("导入失败：" + shortError(e), false);
  }
}

els.btnExport.addEventListener("click", doExport);
els.btnImport.addEventListener("click", () => els.fImport.click());
els.fImport.addEventListener("change", doImport);

init();