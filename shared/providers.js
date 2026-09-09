// 供应商注册表：后台刷新/降级/历史/提醒循环只依赖此处的统一契约（见 docs/ROADMAP.md 注册表重构）。
// 新增供应商时在此注册一个条目即可，后台无需再改动；弹窗渲染仍按各家面板定制（见 ROADMAP 已知取舍）。
// 契约字段：
//   id             存储与快照中的供应商标识（providers.<id>、history.<id>、errors[].provider）
//   name           展示名（通知标题前缀）
//   officialUrl    「打开官方面板」跳转目标
//   defaults       设置缺省值（含初始 enabled）
//   fetchUsage     拉取并整形为面板消费的数据结构；抛错由后台统一降级
//   headlinePct    徽章头条百分比（与面板口径同源）；无可用窗口返回 null
//   hasUsage       拉取失败时判断上次成功数据是否可降级复用
//   emptyData      无可复用数据时的空占位
//   applyConfig    降级复用时以当前设置覆盖的字段（如 GLM 到期日期）
//   historyEntries 每日历史快照项 [{key, pct}]
//   notifyItems    阈值提醒项 [{key, title}]（title 不含供应商名前缀）

import { fetchQuotaLimit } from "./api.js";
import { LEVEL_NAMES, describeLimit, classifyWindow, headlineLimit, THRESHOLDS } from "./constants.js";
import { fetchGoUsage } from "./go.js";
import { clampPct } from "./format.js";

// GLM：限定 h5/weekly 两个窗口参与历史与提醒（与面板展示口径一致）
function glmWindow(limits, key) {
  return Array.isArray(limits) ? limits.find((l) => classifyWindow(l) === key) : null;
}

export const PROVIDERS = [
  {
    id: "glm",
    name: "智谱 GLM",
    officialUrl: "https://open.bigmodel.cn/",
    defaults: { enabled: true, apiKey: "", planExpiry: "" },

    async fetchUsage(cfg) {
      const quota = await fetchQuotaLimit(cfg.apiKey);
      const limits = (quota.limits || []).slice()
        .sort((a, b) => (a.nextResetTime || 0) - (b.nextResetTime || 0))
        .map((l) => ({ ...l, name: describeLimit(l) }));
      return {
        level: quota.level || "unknown",
        levelName: LEVEL_NAMES[quota.level] || quota.level,
        planExpiry: cfg.planExpiry,
        limits,
      };
    },

    // 徽章头条与弹窗同源：优先 5 小时窗口、回退每周，保证徽章数字与面板一致
    headlinePct(data) {
      const credit = headlineLimit(data && data.limits);
      if (!credit) return null;
      const p = Number(credit.percentage);
      return Number.isNaN(p) ? null : clampPct(p);
    },

    hasUsage(prev) {
      return !!(prev && !prev.error && Array.isArray(prev.limits) && prev.limits.length);
    },
    emptyData(cfg) {
      return { level: "unknown", levelName: "unknown", planExpiry: cfg.planExpiry, limits: [] };
    },
    applyConfig(prev, cfg) {
      // 到期日期来自设置而非接口，降级展示时也要跟随当前配置
      return { ...prev, planExpiry: cfg.planExpiry };
    },

    historyEntries(data) {
      const out = [];
      for (const key of ["h5", "weekly"]) {
        const l = glmWindow(data && data.limits, key);
        if (l) out.push({ key, pct: l.percentage });
      }
      return out;
    },
    notifyItems(data) {
      const items = [];
      for (const [key, label] of [["h5", "5 小时"], ["weekly", "每周"]]) {
        const l = glmWindow(data && data.limits, key);
        if (l && Number(l.percentage) >= THRESHOLDS.bad) {
          items.push({ key, title: `${label}额度已用 ${Math.round(Number(l.percentage))}%` });
        }
      }
      return items;
    },
  },
  {
    id: "go",
    name: "OpenCode Go",
    officialUrl: "https://opencode.ai/",
    defaults: { enabled: false, apiKey: "" },

    fetchUsage(cfg) {
      return fetchGoUsage(cfg.apiKey);
    },

    // 徽章取 rolling 5 小时窗口（面板第一条同口径）
    headlinePct(data) {
      const rolling = ((data && data.windows) || []).find((w) => w.key === "rolling");
      return rolling ? clampPct(rolling.percent) : null;
    },

    hasUsage(prev) {
      return !!(prev && !prev.error && Array.isArray(prev.windows) && prev.windows.length);
    },
    emptyData(_cfg, err) {
      return { error: true, message: (err && err.message) || String(err) };
    },
    applyConfig(prev) {
      return prev;
    },

    historyEntries(data) {
      return Array.isArray(data && data.windows)
        ? data.windows.map((w) => ({ key: w.key, pct: w.percent }))
        : [];
    },
    notifyItems(data) {
      const items = [];
      for (const w of Array.isArray(data && data.windows) ? data.windows : []) {
        if (Number(w.percent) >= THRESHOLDS.bad) {
          items.push({ key: w.key, title: `${w.name}额度已用 ${Math.round(Number(w.percent))}%` });
        }
      }
      return items;
    },
  },
];

export const PROVIDER_MAP = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
