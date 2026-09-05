// 智谱中国大陆版监控接口契约与平台常量（已实测校准确认）

export const HOST = "https://open.bigmodel.cn";

// 仅保留扩展实际调用的端点；24h 模型/工具用量端点自 v1.1.0 起不再调用（契约仍记录于 docs/API.md）
export const ENDPOINTS = {
  quotaLimit: `${HOST}/api/monitor/usage/quota/limit`,
};

// 套餐等级 -> 显示名
export const LEVEL_NAMES = {
  lite: "Lite",
  pro: "Pro",
  max: "Max",
};

// 保留知名的额度窗口识别（unit/number 组合）
// unit=3 小时、unit=6 天（按 nextResetTime 升序排序更可靠，这里仅作兜底）
export function describeLimit(limit) {
  if (limit.type !== "CREDIT_LIMIT") return "其他额度";
  if (limit.unit === 3 && limit.number === 5) return "5小时额度";
  if (limit.unit === 6 && limit.number === 1) return "每周额度";
  if (limit.unit === 6 && limit.number === 7) return "每周额度";
  if (limit.unit === 6 && limit.number === 30) return "每月额度";
  return `额度(${limit.unit}/${limit.number})`;
}