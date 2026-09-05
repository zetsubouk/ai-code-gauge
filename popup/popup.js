// 弹窗逻辑：渲染多供应商用量（GLM 智谱大陆 / OpenCode Go），额度卡片分段展示（用量一行、重置时间独立一行）；
// 每次打开强刷；错误显式暴露。

import { nf, fmtTime, fmtRemain, pctColor, daysLeft, fmtDate } from "../shared/format.js";
import { LEVEL_NAMES } from "../shared/constants.js";

const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"), panel: $("panel"),
  glmOn: $("f-glm-on"), glmKey: $("f-glm-key"), glmExpiry: $("f-glm-expiry"),
  goOn: $("f-go-on"), goKey: $("f-go-key"),
  fRefresh: $("f-refresh"), fCycle: $("f-cycle"), btnSave: $("btn-save"), setupMsg: $("setup-msg"),
  planBadge: $("plan-badge"), planExpiry: $("plan-expiry"), goExpiry: $("go-expiry"), lastUpdated: $("last-updated"),
  statusBar: $("status-bar"), planErr: $("plan-err"),
  panes: $("panes"), paneGlm: $("pane-glm"), paneGo: $("pane-go"),
  limits: $("limits"), mcp: $("mcp-wrap"), goLimits: $("go-limits"),
  btnSettings: $("btn-settings"), btnRefresh: $("btn-refresh"),
  footRefresh: $("foot-refresh"),
};

function shortError(e) { return e && e.message ? e.message : (e || "未知错误"); }

/* ---------- GLM 额度窗口识别 ---------- */
function classify(limit) {
  if (limit.type === "CREDIT_LIMIT" && limit.unit === 3 && limit.number === 5) return "h5";
  if (limit.type === "CREDIT_LIMIT" && limit.unit === 6 && (limit.number === 1 || limit.number === 7)) return "weekly";
  return "other";
}

/* ---------- 额度卡片：名称+百分比 / 进度条 / 用量行 / 重置行 ---------- */
const CLOCK_SVG = '<svg class="ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

// 状态类：≥95 红、≥80 黄，进度条与百分比数字联动
function stateCls(pct) { return pct >= 95 ? " bad" : pct >= 80 ? " warn" : ""; }

function limitBar(limit, label) {
  const pct = Math.max(0, Math.min(100, Number(limit.percentage || 0)));
  const cls = stateCls(pct);
  const used = Number(limit.currentValue || 0);
  const total = Number(limit.usage || 0);
  const remaining = limit.remaining;
  const el = document.createElement("div");
  el.className = "limit";

  // 用量行：已用/总额/剩余聚合为一行，不再与重置时间混排
  const metaParts = [];
  if (total && used) metaParts.push(`已用 <b>${nf(used)}</b> / ${nf(total)} 积分`);
  else if (used) metaParts.push(`已用 <b>${nf(used)}</b>`);
  if (remaining !== undefined && remaining !== null) metaParts.push(`剩余 <b>${nf(remaining)}</b>`);
  // 重置行：独立一行弱化展示
  const resetText = limit.nextResetTime
    ? `${fmtRemain(limit.nextResetTime - Date.now())}后重置`
    : "";

  el.innerHTML = `
    <div class="limit-top">
      <span class="limit-name">${label}</span>
      <span class="limit-pct${cls}">${Math.round(pct)}<small>%</small></span>
    </div>
    <div class="limit-track"><div class="limit-fill${cls}" style="width:${pct}%"></div></div>
    <div class="limit-meta">${metaParts.join('<span class="sep">·</span>')}</div>
    <div class="limit-reset">${CLOCK_SVG}<span>${resetText}</span></div>`;
  return el;
}

/* ---------- OpenCode Go 额度卡片（与 GLM 同构） ---------- */
function goBar(w) {
  const pct = Math.max(0, Math.min(100, Number(w.percent) || 0));
  const cls = stateCls(pct);
  const el = document.createElement("div");
  el.className = "limit";

  // Go 接口仅返回百分比，用量行展示已知美元限额
  const metaParts = [];
  if (w.limit) metaParts.push(`限额 <b>$${w.limit}</b>`);
  const resetText = w.endTs
    ? `${fmtRemain(w.endTs - Date.now())}后重置`
    : "";

  el.innerHTML = `
    <div class="limit-top">
      <span class="limit-name">${w.name}</span>
      <span class="limit-pct${cls}">${Math.round(pct)}<small>%</small></span>
    </div>
    <div class="limit-track"><div class="limit-fill${cls}" style="width:${pct}%"></div></div>
    <div class="limit-meta">${metaParts.join('<span class="sep">·</span>')}</div>
    <div class="limit-reset">${CLOCK_SVG}<span>${resetText}</span></div>`;
  return el;
}

/* ---------- MCP ---------- */
function renderMcp(limits, container) {
  container.innerHTML = "";
  const others = limits.filter((l) => classify(l) === "other");
  if (!others.length) return;
  for (const o of others) {
    const pct = Number(o.percentage || 0);
    const color = pctColor(pct);
    const row = document.createElement("div");
    row.className = "mcp-row";
    const used = o.currentValue, total = o.usage;
    row.innerHTML = `
      <span class="l">${o.name || "MCP"} ${total ? ("· " + Math.round(pct) + "%") : ""}</span>
      <span class="v"><b style="color:${color}">${nf(used)}</b> / ${nf(total || "—")} 次</span>`;
    container.appendChild(row);
  }
}

/* ---------- 顶层渲染 ---------- */
function render(payload) {
  if (!payload) {
    els.limits.innerHTML = `<div class="empty">暂无数据，正在刷新…</div>`;
    els.goLimits.innerHTML = "";
    return;
  }
  const prov = payload.providers || {};
  const glm = prov.glm;
  const go = prov.go;
  // 判定"是否启用/有数据呈现"：glm 启用且非仅 error 占位；go 启用
  const glmShown = !!(glm && !(glm.error && !glm.limits));
  const goShown = !!(go && !go.error);

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
  els.lastUpdated.textContent = payload.fetchedAt ? fmtTime(payload.fetchedAt) + " 更新" : "";

  // 错误（按供应商）
  const errs = payload.errors || [];
  const glmErr = errs.find((e) => e.provider === "glm");
  const goErr = errs.find((e) => e.provider === "go");
  els.planErr.hidden = !glmErr;
  if (glmErr) els.planErr.textContent = "GLM 用量查询失败：" + shortError(glmErr);
  const otherErrs = errs.filter((e) => e.provider !== "glm");
  els.statusBar.hidden = otherErrs.length === 0;
  if (otherErrs.length) {
    els.statusBar.className = "status" + (otherErrs.some((e) => e.kind === "invalid_key") ? " bad" : "");
    els.statusBar.textContent = otherErrs.map((e) => `OpenCode Go：` + shortError(e)).join("；");
  }

  // 分栏：双供应商时两栏并排并加宽弹窗，根治窄栏挤压换行
  const both = glmShown && goShown;
  document.body.classList.toggle("wide", both);

  // GLM 栏
  els.paneGlm.hidden = !glmShown;
  if (glmShown) {
    const limits = (glm && glm.limits) || [];
    els.limits.innerHTML = "";
    els.mcp.innerHTML = "";
    if (!limits.length) {
      els.limits.innerHTML = `<div class="empty">未查询到额度。</div>`;
    } else {
      const h5 = limits.find((l) => classify(l) === "h5");
      const weekly = limits.find((l) => classify(l) === "weekly");
      if (h5) els.limits.appendChild(limitBar(h5, "5 小时"));
      if (weekly) els.limits.appendChild(limitBar(weekly, "本周"));
      const leftover = limits.filter((l) => classify(l) === "other");
      if (leftover.length && !h5 && !weekly) els.limits.appendChild(limitBar(leftover[0], leftover[0].name || "额度"));
      renderMcp(leftover || [], els.mcp);
    }
  }

  // Go 栏
  els.paneGo.hidden = !goShown;
  if (goShown) {
    els.goLimits.innerHTML = "";
    const windows = (go && go.windows) || [];
    if (!windows.length) {
      els.goLimits.innerHTML = `<div class="empty">OpenCode Go 无用量数据。</div>`;
    } else {
      windows.forEach((w) => els.goLimits.appendChild(goBar(w)));
    }
  }
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
    if (resp && resp.data) render(resp.data);
    else if (resp && resp.reason === "no_key") showSetup();
    else if (resp && resp.error) {
      render({ fetchedAt: Date.now(), providers: {}, errors: [{ provider: "glm", message: "刷新失败：" + resp.error, kind: "server" }] });
    }
  } catch (e) {
    render({ fetchedAt: Date.now(), providers: {}, errors: [{ provider: "glm", message: "刷新失败：" + shortError(e), kind: "network" }] });
  } finally { setRefreshBusy(false); }
}

function showSetup() { els.panel.hidden = true; els.setup.hidden = false; }
function showPanel() { els.setup.hidden = true; els.panel.hidden = false; }

function syncFieldsVisibility() {
  els.glmKey.closest(".prov-fields").hidden = !els.glmOn.checked;
  els.goKey.closest(".prov-fields").hidden = !els.goOn.checked;
}

async function init() {
  const got = await chrome.storage.local.get(["lastData", "lastFetchAt", "providers", "refreshMin", "badgeCycleSec"]);
  const prov = got.providers || { glm: {}, go: {} };
  const glm = prov.glm || {}, go = prov.go || {};
  els.glmOn.checked = glm.enabled !== false;
  els.glmKey.value = glm.apiKey || ""; els.glmExpiry.value = glm.planExpiry || "";
  els.goOn.checked = go.enabled === true;
  els.goKey.value = go.apiKey || "";
  syncFieldsVisibility();
  els.fRefresh.value = String(got.refreshMin || 10);
  els.fCycle.value = String(got.badgeCycleSec || 10);
  els.footRefresh.textContent = `每 ${got.refreshMin || 10} 分钟自动刷新`;

  const anyEnabled = (glm.enabled && glm.apiKey) || (go.enabled && go.apiKey);
  if (!anyEnabled) { showSetup(); return; }
  showPanel();
  if (got.lastData) render(got.lastData);
  doRefresh();
}

/* ---------- 事件 ---------- */
els.glmOn.addEventListener("change", syncFieldsVisibility);
els.goOn.addEventListener("change", syncFieldsVisibility);
els.btnRefresh.addEventListener("click", doRefresh);
els.btnSettings.addEventListener("click", showSetup);

els.btnSave.addEventListener("click", async () => {
  const providers = {
    glm: {
      enabled: els.glmOn.checked,
      apiKey: els.glmKey.value.trim(),
      planExpiry: els.glmExpiry.value || "",
    },
    go: { enabled: els.goOn.checked, apiKey: els.goKey.value.trim() },
  };
  // 校验：开启的供应商必须有 key
  const needs =
    (providers.glm.enabled && !providers.glm.apiKey ? "\n· GLM 未填 API Key" : "") +
    (providers.go.enabled && !providers.go.apiKey ? "\n· OpenCode Go 未填 API Key" : "");
  if (needs) { show("请补充必填项：" + needs, false); return; }
  if (providers.glm.planExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(providers.glm.planExpiry)) {
    show("GLM 到期日期格式应为 YYYY-MM-DD。", false); return;
  }
  const refreshMin = Number(els.fRefresh.value) || 10;
  const badgeCycleSec = Number(els.fCycle.value) || 10;
  await chrome.storage.local.set({ providers, refreshMin, badgeCycleSec });
  show("已保存，正在查询…", true);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "settingsChanged" });
    if (!resp) throw new Error("后台无响应");
    const glmErr = resp.data && (resp.data.errors || []).find((e) => e.provider === "glm" && e.kind === "invalid_key");
    if (glmErr) { show("GLM API Key 校验失败：" + shortError(glmErr), false); return; }
    const goErr = resp.data && (resp.data.errors || []).find((e) => e.provider === "go" && e.kind === "invalid_key");
    if (goErr) { show("OpenCode Go API Key 校验失败：" + shortError(goErr), false); return; }
    if (resp.data) render(resp.data);
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

init();