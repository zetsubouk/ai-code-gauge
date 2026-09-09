// 用真实密钥跑通线上链路（Node 18+），验证契约与解析逻辑。带断言：任一失败退出码非 0。
// 用法：BIGMODEL_KEY=<glm key> GO_KEY=<opencode go key> DS_KEY=<deepseek key> node scripts/test-api.mjs
// 缺 key 的供应商自动跳过；所有 key 都缺时退出码 2。
// 注：24h 模型/工具用量接口自 v1.1.0 起不再被扩展调用，故不在冒烟范围内。
import assert from "node:assert/strict";
import { fetchQuotaLimit } from "../shared/api.js";
import { LEVEL_NAMES, describeLimit } from "../shared/constants.js";
import { fetchGoUsage, GO_WINDOW_LIMITS } from "../shared/go.js";
import { fetchBalance } from "../shared/deepseek.js";
import { fmtTime, pctColor } from "../shared/format.js";

const glmKey = process.env.BIGMODEL_KEY;
const goKey = process.env.GO_KEY;
const dsKey = process.env.DS_KEY;
if (!glmKey && !goKey && !dsKey) {
  console.error("缺少 BIGMODEL_KEY / GO_KEY / DS_KEY 环境变量");
  process.exit(2);
}

let failures = 0;

if (glmKey) {
  console.log("=== GLM fetchQuotaLimit ===");
  try {
    const quota = await fetchQuotaLimit(glmKey);
    assert.ok(["lite", "pro", "max", "unknown"].includes(quota.level), `level 异常: ${quota.level}`);
    assert.ok(Array.isArray(quota.limits), "limits 应为数组");
    console.log("level:", quota.level, "->", LEVEL_NAMES[quota.level]);
    for (const l of quota.limits) {
      console.log(
        `  - ${describeLimit(l)} | used=${l.currentValue}/${l.usage} (${l.percentage}%)`,
        `rem=${l.remaining} | nextReset=${fmtTime(l.nextResetTime)} | type=${l.type} unit=${l.unit} num=${l.number}`
      );
      assert.ok(l.percentage >= 0 && l.percentage <= 100, `percentage 越界: ${l.percentage}`);
    }
    // 徽章取 5 小时窗口（nextResetTime 最早的一条 CREDIT_LIMIT）
    const credit = quota.limits.find((x) => x.type === "CREDIT_LIMIT");
    if (credit) {
      const pct = Number(credit.percentage);
      console.log(`  徽章: ${Math.round(pct)}% 颜色 ${pctColor(pct)}`);
    }
  } catch (e) {
    failures++;
    console.error("GLM 冒烟失败:", e.kind || "", e.message);
  }
} else {
  console.log("=== GLM 跳过（未设 BIGMODEL_KEY） ===");
}

if (goKey) {
  console.log("=== OpenCode Go fetchGoUsage ===");
  try {
    const data = await fetchGoUsage(goKey);
    const keys = data.windows.map((w) => w.key);
    assert.ok(keys.includes("rolling"), "应包含 rolling 窗口");
    for (const w of data.windows) {
      console.log(`  - ${w.name} | ${w.percent}% | reset=${w.resetsAt} | 参考限额=$${w.limit}`);
      assert.ok(w.percent >= 0 && w.percent <= 100, `percent 越界: ${w.percent}`);
      assert.equal(w.limit, GO_WINDOW_LIMITS[w.key]);
    }
  } catch (e) {
    failures++;
    console.error("OpenCode Go 冒烟失败:", e.kind || "", e.message);
  }
} else {
  console.log("=== OpenCode Go 跳过（未设 GO_KEY） ===");
}

if (dsKey) {
  console.log("=== DeepSeek fetchBalance ===");
  try {
    const bal = await fetchBalance(dsKey);
    assert.equal(typeof bal.total, "number", "total 应为数字");
    assert.ok(bal.total >= 0, "余额为负");
    console.log(
      `  - 可用=${bal.isAvailable} | ${bal.currency} 总余额=${bal.total.toFixed(2)}`,
      `| 赠金=${bal.granted.toFixed(2)} | 充值=${bal.toppedUp.toFixed(2)}`
    );
  } catch (e) {
    failures++;
    console.error("DeepSeek 冒烟失败:", e.kind || "", e.message);
  }
} else {
  console.log("=== DeepSeek 跳过（未设 DS_KEY） ===");
}

console.log(failures ? `=== done，${failures} 项失败 ===` : "=== done，全部通过 ===");
process.exit(failures ? 1 : 0);
