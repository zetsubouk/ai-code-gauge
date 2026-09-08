// 弹窗逻辑：渲染多供应商用量（GLM 智谱大陆 / OpenCode Go），额度卡片分段展示（用量一行、重置时间独立一行）；
// 每次打开强刷；错误显式暴露。

import { nf, fmtTime, fmtRemain, pctColor, pctState, clampPct, daysLeft, fmtDate } from "../shared/format.js";
import { LEVEL_NAMES, classifyWindow, THRESHOLDS } from "../shared/constants.js";
import { lastDays } from "../shared/history.js";
import { validateSettingsImport } from "../shared/io.js";

const $ = (id) => document.getElementById(id);

const els = {
  setup: $("setup"), panel: $("panel"),
  glmOn: $("f-glm-on"), glmKey: $("f-glm-key"), glmExpiry: $("f-glm-expiry"),
  goOn: $("f-go-on"), goKey: $("f-go-key"),
  fRefresh: $("f-refresh"), fCycle: $("f-cycle"), fNotify: $("f-notify"), btnSave: $("btn-save"), setupMsg: $("setup-msg"),
  btnExport: $("btn-export"), btnImport: $("btn-import"), fImport: $("f-import"), fExportKeys: $("f-export-keys"),
  planBadge: $("plan-badge"), planExpiry: $("plan-expiry"), goExpiry: $("go-expiry"), lastUpdated: $("last-updated"),
  statusBar: $("status-bar"), planErr: $("plan-err"),
  panes: $("panes"), paneGlm: $("pane-glm"), paneGo: $("pane-go"),
  limits: $("limits"), mcp: $("mcp-wrap"), goLimits: $("go-limits"),
  btnSettings: $("btn-settings"), btnRefresh: $("btn-refresh"),
  footRefresh: $("foot-refresh"),
};

function shortError(e) { return e && e.message ? e.message : (e || "未知错误"); }

/* ---------- 额度卡片构建：动态文本一律 textContent/DOM 构建，仅静态 SVG 图标用 innerHTML ---------- */
const CLOCK_SVG = '<svg class="ic" viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

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

// 卡片结构：名称+百分比 / 进度条（带 aria）/ 用量行 / 重置行 / 近 7 日趋势
function buildCard({ name, pct, metaSegs, resetText, trend = [] }) {
  const pctInt = Math.round(pct);
  const state = pctState(pct);

  const top = document.createElement("div");
  top.className = "limit-top";
  const nameEl = document.createElement("span");
  nameEl.className = "limit-name";
  nameEl.textContent = name;
  const pctEl = document.createElement("span");
  pctEl.className = "limit-pct" + state;
  pctEl.append(String(pctInt));
  const small = document.createElement("small");
  small.textContent = "%";
  pctEl.appendChild(small);
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

  // 近 7 日趋势：纯 CSS 迷你柱条，装饰性（卡片文字已含当日数据）
  if (trend.length) {
    const trendEl = document.createElement("div");
    trendEl.className = "trend";
    trendEl.setAttribute("aria-hidden", "true");
    for (const e of trend) {
      const p = clampPct(e.p);
      const bar = document.createElement("i");
      bar.style.height = Math.max(8, Math.round(p)) + "%";
      if (p >= THRESHOLDS.bad) bar.classList.add("bad");
      else if (p >= THRESHOLDS.warn) bar.classList.add("warn");
      bar.title = `${e.d} ${Math.round(p)}%`;
      trendEl.appendChild(bar);
    }
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
  return buildCard({ name: label, pct, metaSegs, resetText, trend });
}

/* ---------- OpenCode Go 额度卡片（与 GLM 同构） ---------- */
function goBar(w, trend) {
  const pct = clampPct(w.percent);
  // Go 接口仅返回百分比，用量行展示已知档位的参考限额
  const metaSegs = w.limit ? [metaSeg("参考限额 ", `$${w.limit}`)] : [];
  const resetText = w.endTs
    ? `${fmtRemain(w.endTs - Date.now())}后重置`
    : "";
  return buildCard({ name: w.name, pct, metaSegs, resetText, trend });
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

/* ---------- 顶层渲染 ---------- */
function render(payload, history) {
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
    const histGlm = (history && history.glm) || {};
    els.limits.innerHTML = "";
    els.mcp.innerHTML = "";
    if (!limits.length) {
      els.limits.innerHTML = `<div class="empty">未查询到额度。</div>`;
    } else {
      const h5 = limits.find((l) => classifyWindow(l) === "h5");
      const weekly = limits.find((l) => classifyWindow(l) === "weekly");
      if (h5) els.limits.appendChild(limitBar(h5, "5 小时", lastDays(histGlm.h5)));
      if (weekly) els.limits.appendChild(limitBar(weekly, "本周", lastDays(histGlm.weekly)));
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
      const { history } = await chrome.storage.local.get(["history"]);
      render(resp.data, history);
    }
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

function fillSettings(got) {
  const prov = got.providers || {};
  const glm = prov.glm || {}, go = prov.go || {};
  els.glmOn.checked = glm.enabled !== false;
  els.glmKey.value = glm.apiKey || ""; els.glmExpiry.value = glm.planExpiry || "";
  els.goOn.checked = go.enabled === true;
  els.goKey.value = go.apiKey || "";
  syncFieldsVisibility();
  els.fRefresh.value = String(got.refreshMin || 10);
  els.fCycle.value = String(got.badgeCycleSec || 10);
  els.fNotify.checked = got.notify === true;
}

async function init() {
  const got = await chrome.storage.local.get(["lastData", "lastFetchAt", "providers", "refreshMin", "badgeCycleSec", "notify", "history"]);
  fillSettings(got);
  els.footRefresh.textContent = `每 ${got.refreshMin || 10} 分钟自动刷新`;

  const glm = (got.providers || {}).glm || {}, go = (got.providers || {}).go || {};
  const anyEnabled = (glm.enabled && glm.apiKey) || (go.enabled && go.apiKey);
  if (!anyEnabled) { showSetup(); return; }
  showPanel();
  if (got.lastData) render(got.lastData, got.history);
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
  const notify = els.fNotify.checked;
  await chrome.storage.local.set({ providers, refreshMin, badgeCycleSec, notify });
  show("已保存，正在查询…", true);
  try {
    const resp = await chrome.runtime.sendMessage({ type: "settingsChanged" });
    if (!resp) throw new Error("后台无响应");
    const glmErr = resp.data && (resp.data.errors || []).find((e) => e.provider === "glm" && e.kind === "invalid_key");
    if (glmErr) { show("GLM API Key 校验失败：" + shortError(glmErr), false); return; }
    const goErr = resp.data && (resp.data.errors || []).find((e) => e.provider === "go" && e.kind === "invalid_key");
    if (goErr) { show("OpenCode Go API Key 校验失败：" + shortError(goErr), false); return; }
    if (resp.data) {
      const { history } = await chrome.storage.local.get(["history"]);
      render(resp.data, history);
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
    const got = await chrome.storage.local.get(["providers", "refreshMin", "badgeCycleSec", "notify"]);
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
        },
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
    };
    await chrome.storage.local.set({
      providers,
      refreshMin: s.refreshMin,
      badgeCycleSec: s.badgeCycleSec,
      notify: s.notify,
    });
    fillSettings(await chrome.storage.local.get(["providers", "refreshMin", "badgeCycleSec", "notify"]));
    show("已导入，正在查询…", true);
    const resp = await chrome.runtime.sendMessage({ type: "settingsChanged" });
    if (resp && resp.data) {
      const { history } = await chrome.storage.local.get(["history"]);
      render(resp.data, history);
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