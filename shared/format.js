// 格式化辅助（背景与弹窗共用）

/** 千分位 */
export function nf(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("zh-CN");
}

/** 时间戳(ms) -> HH:mm（当天）/ MM-DD HH:mm */
export function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? `${p(d.getHours())}:${p(d.getMinutes())}`
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`;
}

/** 时间戳(ms) -> 本地时区 YYYY-MM-DD（套餐到期日等纯日期展示，禁用 UTC 切片避免日期偏差） */
export function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 剩余毫秒 -> 友好的中文剩余时长 */
export function fmtRemain(ms) {
  if (ms < 0) return "已到重置时间";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "不足1分钟";
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  const days = Math.floor(h / 24);
  const hh = h % 24;
  return hh ? `${days} 天 ${hh} 小时` : `${days} 天`;
}

/** 徽章颜色：绿 <80%、黄 80–95%、红 >95% */
export function pctColor(pct) {
  if (pct >= 95) return "#C62828"; // 红
  if (pct >= 80) return "#F9A825"; // 黄
  return "#2E7D32"; // 绿
}

/** 距某日期(YYYY-MM-DD)的天数；无效返回 null。正值=剩 N 天，0=今天到期，负=已过期 */
export function daysLeft(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

/** 徽章文本：整数百分比 + %，超长子符处理 */
export function badgeText(pct) {
  const v = Math.round(Number(pct) || 0);
  if (v > 999) return "999+";
  return `${v}%`;
}