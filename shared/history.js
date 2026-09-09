// 用量历史：本地每日快照（按天去重、有界保留），供弹窗绘制近 7 日趋势。
// 只存 {d: 'YYYY-MM-DD', p: 百分比整数}，不含任何账号信息。

import { clampPct } from "./format.js";

export const MAX_DAYS = 30;
export const TREND_DAYS = 7;

/** 单窗口历史按天更新：同日覆盖为最新值，按日期升序，最多保留 MAX_DAYS 条。
 *  默认按百分比口径钳制 0–100 后取整；opts.raw 为 true 时仅取整不钳制（余额型存「分」等非百分比数值）。 */
export function upsertDay(arr, day, pct, opts = {}) {
  const v = opts.raw ? Math.round(Number(pct) || 0) : Math.round(clampPct(pct));
  const base = Array.isArray(arr) ? arr.filter((e) => e && typeof e.d === "string" && e.d !== day) : [];
  base.push({ d: day, p: v });
  return base.slice(-MAX_DAYS);
}

/** 取最近 n 天序列（按日期升序），入参非法时返回空数组 */
export function lastDays(arr, n = TREND_DAYS) {
  return Array.isArray(arr) ? arr.slice(-Math.max(1, n)) : [];
}

/**
 * 趋势文案数据（方案 A）：近 N 日日均 X% · 今日 Y%；仅 1 天时 avg 为 null（调用方显示「今日 X%（首日记录）」）。
 * 无数据返回 null，调用方整行隐藏。pct 均为已取整数值。
 */
export function describeTrend(arr, n = TREND_DAYS) {
  const days = lastDays(arr, n);
  if (!days.length) return null;
  const today = days[days.length - 1].p;
  if (days.length === 1) return { days: 1, today, avg: null };
  const sum = days.reduce((acc, e) => acc + e.p, 0);
  return { days: days.length, today, avg: Math.round(sum / days.length) };
}
