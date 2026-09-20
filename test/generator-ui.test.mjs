import test from "node:test";
import assert from "node:assert/strict";
import { generatorMetrics, generatorRunLabel } from "../public/features/generators/index.js";

test("generator UI reports pending one-shot schedules and run totals", () => {
  assert.deepEqual(generatorMetrics([
    { scheduleState: "pending" }, { scheduleState: "fired" }, { scheduleState: null }
  ], [{}, {}]), { count: 3, pendingCount: 1, runCount: 2 });
});

test("generator UI uses distinct truthful run labels", () => {
  assert.equal(generatorRunLabel("materializing"), "准备队列");
  assert.equal(generatorRunLabel("queued"), "排队中");
  assert.equal(generatorRunLabel("running"), "执行中");
  assert.equal(generatorRunLabel("completed"), "已完成");
  assert.equal(generatorRunLabel("failed"), "有异常");
});
