// shared/io.js 设置导入校验测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSettingsImport } from "../shared/io.js";

test("完整合法配置：原样规整通过", () => {
  const s = validateSettingsImport({
    app: "ai-code-gauge",
    settings: {
      providers: {
        glm: { enabled: true, apiKey: " k1 ", planExpiry: "2026-12-31" },
        go: { enabled: true, apiKey: "k2" },
      },
      refreshMin: 15,
      badgeCycleSec: 30,
      notify: true,
    },
  });
  assert.equal(s.providers.glm.apiKey, "k1"); // trim
  assert.equal(s.providers.glm.planExpiry, "2026-12-31");
  assert.equal(s.providers.go.enabled, true);
  assert.equal(s.refreshMin, 15);
  assert.equal(s.badgeCycleSec, 30);
  assert.equal(s.notify, true);
});

test("缺 settings 字段：拒绝", () => {
  assert.throws(() => validateSettingsImport(null), /settings/);
  assert.throws(() => validateSettingsImport({ foo: 1 }), /settings/);
  assert.throws(() => validateSettingsImport("junk"), /settings/);
});

test("到期日期格式非法：拒绝", () => {
  assert.throws(
    () => validateSettingsImport({ settings: { providers: { glm: { planExpiry: "2026/12/31" } } } }),
    /YYYY-MM-DD/
  );
});

test("数字区间钳制而非拒绝；enabled 默认值与弹窗口径一致", () => {
  const s = validateSettingsImport({
    settings: {
      providers: { glm: {}, go: {} },
      refreshMin: 99,
      badgeCycleSec: 1,
      notify: "yes",
    },
  });
  assert.equal(s.refreshMin, 30); // 钳到上限
  assert.equal(s.badgeCycleSec, 5); // 钳到下限
  assert.equal(s.providers.glm.enabled, true); // glm 缺省开启
  assert.equal(s.providers.go.enabled, false); // go 缺省关闭
  assert.equal(s.notify, false); // 仅布尔 true 生效
});

test("apiKey 非字符串时归空", () => {
  const s = validateSettingsImport({
    settings: { providers: { glm: { apiKey: 12345 }, go: { apiKey: null } } },
  });
  assert.equal(s.providers.glm.apiKey, "");
  assert.equal(s.providers.go.apiKey, "");
});
