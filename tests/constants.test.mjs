// shared/constants.js 窗口识别与阈值口径测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { LEVEL_NAMES, THRESHOLDS, describeLimit, classifyWindow } from "../shared/constants.js";

test("describeLimit：unit/number 组合映射", () => {
  assert.equal(describeLimit({ type: "CREDIT_LIMIT", unit: 3, number: 5 }), "5小时额度");
  assert.equal(describeLimit({ type: "CREDIT_LIMIT", unit: 6, number: 1 }), "每周额度");
  assert.equal(describeLimit({ type: "CREDIT_LIMIT", unit: 6, number: 7 }), "每周额度");
  assert.equal(describeLimit({ type: "CREDIT_LIMIT", unit: 6, number: 30 }), "每月额度");
  assert.equal(describeLimit({ type: "CREDIT_LIMIT", unit: 9, number: 9 }), "额度(9/9)");
  assert.equal(describeLimit({ type: "OTHER", unit: 3, number: 5 }), "其他额度");
});

test("classifyWindow：h5/weekly/other 归类（每月额度归 other，由 MCP 区展示）", () => {
  assert.equal(classifyWindow({ type: "CREDIT_LIMIT", unit: 3, number: 5 }), "h5");
  assert.equal(classifyWindow({ type: "CREDIT_LIMIT", unit: 6, number: 1 }), "weekly");
  assert.equal(classifyWindow({ type: "CREDIT_LIMIT", unit: 6, number: 7 }), "weekly");
  assert.equal(classifyWindow({ type: "CREDIT_LIMIT", unit: 6, number: 30 }), "other");
  assert.equal(classifyWindow({ type: "OTHER", unit: 3, number: 5 }), "other");
});

test("LEVEL_NAMES 与 THRESHOLDS 口径", () => {
  assert.equal(LEVEL_NAMES.lite, "Lite");
  assert.equal(LEVEL_NAMES.pro, "Pro");
  assert.equal(LEVEL_NAMES.max, "Max");
  assert.deepEqual(THRESHOLDS, { warn: 80, bad: 95 });
});
