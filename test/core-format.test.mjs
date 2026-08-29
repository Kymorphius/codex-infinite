import test from "node:test";
import assert from "node:assert/strict";
import { formatDuration, formatTokens, taskStatusLabel } from "../public/core/format.js";

test("shared UI formatting preserves task labels and bounded duration units", () => {
  assert.equal(taskStatusLabel({ status: "active" }), "进行中");
  assert.equal(taskStatusLabel({ status: "interrupted" }), "异常");
  assert.equal(taskStatusLabel({ status: "queued" }), "待处理");
  assert.equal(formatDuration(30_000), "1 分钟");
  assert.equal(formatDuration(7_200_000), "2.0 小时");
  assert.equal(formatDuration(172_800_000), "2.0 天");
  assert.equal(formatTokens(123456), "123,456");
});
