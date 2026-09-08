// shared/format.js 纯函数单元测试（node:test，零依赖）
import { test } from "node:test";
import assert from "node:assert/strict";
import { nf, fmtTime, fmtDate, fmtRemain, daysLeft, pctColor, pctState, badgeText, clampPct } from "../shared/format.js";

test("nf：千分位与非法输入", () => {
  assert.equal(nf(0), "0");
  assert.equal(nf(12345), "12,345");
  assert.equal(nf(null), "—");
  assert.equal(nf(undefined), "—");
  assert.equal(nf(NaN), "—");
  assert.equal(nf("—"), "—");
});

test("fmtDate：本地时区 YYYY-MM-DD，不受 UTC 切片影响", () => {
  const ts = new Date(2026, 8, 8, 23, 30).getTime();
  assert.equal(fmtDate(ts), "2026-09-08");
  assert.equal(fmtDate(0), "");
  assert.equal(fmtDate(null), "");
});

test("fmtTime：当天 HH:mm，跨天 MM-DD HH:mm", () => {
  const now = new Date();
  const p = (n) => String(n).padStart(2, "0");
  assert.equal(fmtTime(now.getTime()), `${p(now.getHours())}:${p(now.getMinutes())}`);
  assert.equal(fmtTime(new Date(2020, 0, 2, 3, 4).getTime()), "01-02 03:04");
  assert.equal(fmtTime(0), "—");
});

test("fmtRemain：中文剩余时长", () => {
  assert.equal(fmtRemain(-1), "已到重置时间");
  assert.equal(fmtRemain(30 * 1000), "不足1分钟");
  assert.equal(fmtRemain(45 * 60000), "45 分钟");
  assert.equal(fmtRemain(90 * 60000), "1 小时 30 分");
  assert.equal(fmtRemain(3 * 3600000), "3 小时");
  assert.equal(fmtRemain(25 * 3600000), "1 天 1 小时");
  assert.equal(fmtRemain(2 * 86400000), "2 天");
});

test("daysLeft：按本地零点计算天数", () => {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(daysLeft(iso(tomorrow)), 1);
  assert.equal(daysLeft(iso(new Date())), 0);
  assert.equal(daysLeft(iso(yesterday)), -1);
  assert.equal(daysLeft("not-a-date"), null);
  assert.equal(daysLeft(""), null);
});

test("pctColor/pctState：同一阈值口径（>=80 黄，>=95 红）", () => {
  assert.equal(pctColor(79.9), "#2E7D32");
  assert.equal(pctColor(80), "#F9A825");
  assert.equal(pctColor(94.9), "#F9A825");
  assert.equal(pctColor(95), "#C62828");
  assert.equal(pctState(79.9), "");
  assert.equal(pctState(80), " warn");
  assert.equal(pctState(94.9), " warn");
  assert.equal(pctState(95), " bad");
});

test("badgeText：整数百分比与超长截断", () => {
  assert.equal(badgeText(0), "0%");
  assert.equal(badgeText(42.4), "42%");
  assert.equal(badgeText("87"), "87%");
  assert.equal(badgeText(1000), "999+");
});

test("clampPct：越界与非法值钳制", () => {
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct(120), 100);
  assert.equal(clampPct("37"), 37);
  assert.equal(clampPct(NaN), 0);
  assert.equal(clampPct(undefined), 0);
});
