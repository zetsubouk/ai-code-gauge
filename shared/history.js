// 用量历史：本地每日快照（按天去重、有界保留），供弹窗绘制近 7 日趋势。
// 只存 {d: 'YYYY-MM-DD', p: 百分比整数}，不含任何账号信息。

import { clampPct } from "./format.js";

export const MAX_DAYS = 30;
export const TREND_DAYS = 7;

/** 单窗口历史按天更新：同日覆盖为最新值，按日期升序，最多保留 MAX_DAYS 条 */
export function upsertDay(arr, day, pct) {
  const base = Array.isArray(arr) ? arr.filter((e) => e && typeof e.d === "string" && e.d !== day) : [];
  base.push({ d: day, p: Math.round(clampPct(pct)) });
  return base.slice(-MAX_DAYS);
}

/** 取最近 n 天序列（按日期升序），入参非法时返回空数组 */
export function lastDays(arr, n = TREND_DAYS) {
  return Array.isArray(arr) ? arr.slice(-Math.max(1, n)) : [];
}

/** 补齐为固定 n 槽的趋势序列（最右为最新一天），无数据的天以 null 占位 */
export function trendSlots(trend, n = TREND_DAYS) {
  const arr = Array.isArray(trend) ? trend.slice(-n) : [];
  const pad = Math.max(0, n - arr.length);
  return [...Array.from({ length: pad }, () => null), ...arr];
}
