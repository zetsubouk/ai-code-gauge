// 用真实密钥跑通 shared/api.js 的额度查询链路（Node 18+），验证契约与解析逻辑。
// 用法：BIGMODEL_KEY=<key> node scripts/test-api.mjs
// 注：24h 模型/工具用量接口自 v1.1.0 起不再被扩展调用，故不在冒烟范围内。
import { fetchQuotaLimit } from "../shared/api.js";
import { LEVEL_NAMES, describeLimit } from "../shared/constants.js";
import { fmtTime, pctColor } from "../shared/format.js";

const key = process.env.BIGMODEL_KEY;
if (!key) {
  console.error("缺少 BIGMODEL_KEY 环境变量");
  process.exit(2);
}

console.log("=== fetchQuotaLimit ===");
try {
  const quota = await fetchQuotaLimit(key);
  console.log("level:", quota.level, "->", LEVEL_NAMES[quota.level]);
  for (const l of quota.limits) {
    console.log(
      `  - ${describeLimit(l)} | used=${l.currentValue}/${l.usage} (${l.percentage}%)`,
      `rem=${l.remaining} | nextReset=${fmtTime(l.nextResetTime)} | type=${l.type} unit=${l.unit} num=${l.number}`
    );
  }
  // 徽章取 5 小时窗口（nextResetTime 最早的一条 CREDIT_LIMIT）
  const credit = quota.limits.find((x) => x.type === "CREDIT_LIMIT");
  if (credit) {
    const pct = Number(credit.percentage);
    console.log(`  徽章: ${Math.round(pct)}% 颜色 ${pctColor(pct)}`);
  }
} catch (e) {
  console.log("quota ERROR:", e.kind, e.message);
}

console.log("=== done ===");
