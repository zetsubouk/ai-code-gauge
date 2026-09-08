// shared/history.js 每日快照存储测试
import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertDay, lastDays, MAX_DAYS, TREND_DAYS } from "../shared/history.js";

test("upsertDay：新日期追加，旧顺序保持升序", () => {
  let arr = upsertDay([], "2026-09-01", 10);
  arr = upsertDay(arr, "2026-09-02", 20);
  assert.deepEqual(arr, [{ d: "2026-09-01", p: 10 }, { d: "2026-09-02", p: 20 }]);
});

test("upsertDay：同日覆盖为最新值，不产生重复", () => {
  let arr = upsertDay([], "2026-09-01", 10);
  arr = upsertDay(arr, "2026-09-01", 55);
  assert.deepEqual(arr, [{ d: "2026-09-01", p: 55 }]);
});

test("upsertDay：百分比钳制并取整", () => {
  const arr = upsertDay([], "2026-09-01", 142.6);
  assert.equal(arr[0].p, 100);
  assert.equal(upsertDay([], "2026-09-01", -5)[0].p, 0);
  assert.equal(upsertDay([], "2026-09-01", "abc")[0].p, 0);
});

test("upsertDay：有界保留最近 MAX_DAYS 天", () => {
  let arr = [];
  for (let i = 1; i <= MAX_DAYS + 5; i++) {
    const day = i <= 31 ? `2026-01-${String(i).padStart(2, "0")}` : `2026-02-${String(i - 31).padStart(2, "0")}`;
    arr = upsertDay(arr, day, i);
  }
  assert.equal(arr.length, MAX_DAYS);
  assert.equal(arr[0].d, "2026-01-06"); // 最早 5 天被丢弃
  assert.equal(arr.at(-1).d, "2026-02-04");
});

test("upsertDay：非法入参不抛错，按空历史处理", () => {
  assert.deepEqual(upsertDay(null, "2026-09-01", 10), [{ d: "2026-09-01", p: 10 }]);
  assert.deepEqual(upsertDay("junk", "2026-09-01", 10), [{ d: "2026-09-01", p: 10 }]);
});

test("lastDays：取最近 n 天，非法入参返回空数组", () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ d: `d${i}`, p: i }));
  assert.equal(lastDays(arr).length, TREND_DAYS);
  assert.equal(lastDays(arr, 3).at(-1).d, "d9");
  assert.deepEqual(lastDays(null), []);
  assert.deepEqual(lastDays("junk"), []);
  assert.deepEqual(lastDays([], 7), []);
});
