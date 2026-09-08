import test from "node:test";
import assert from "node:assert/strict";
import { destinationProjectNames, dispatchColumnStatus, dispatchMetrics, filterDispatches } from "../public/features/dispatch/index.js";
import { localDateTimeValue, scheduleRelativeLabel } from "../public/features/dispatch/details.js";

test("dispatch UI groups cancelled work with failures and reports truthful metrics", () => {
  const items = [
    { id: "1", status: "queued", targetThreadId: "thread-a" },
    { id: "2", status: "sending", targetThreadId: "thread-a" },
    { id: "3", status: "cancelled", targetThreadId: "thread-b" }
  ];
  assert.equal(dispatchColumnStatus("cancelled"), "failed");
  assert.equal(dispatchColumnStatus("delivery_unknown"), "failed");
  assert.equal(dispatchColumnStatus("sent"), "sent");
  assert.deepEqual(dispatchMetrics(items), { count: 3, waitingCount: 2, targetCount: 2 });
});

test("dispatch destinations are unique, sorted, and retain unclassified tasks", () => {
  assert.deepEqual(destinationProjectNames([
    { project: "beta" }, { project: "alpha" }, { project: "beta" }, {}
  ]), ["未归类", "alpha", "beta"]);
});

test("dispatch filtering composes normalized text and exact project filters", () => {
  const items = [
    { id: "1", title: "发布检查", prompt: "运行测试", project: "控制台", targetThreadTitle: "Release" },
    { id: "2", title: "整理资料", prompt: "归档", project: "文献库", targetThreadTitle: "Research", lastError: "网络超时" }
  ];
  assert.deepEqual(filterDispatches(items, { query: " RELEASE " }).map((item) => item.id), ["1"]);
  assert.deepEqual(filterDispatches(items, { query: "超时" }).map((item) => item.id), ["2"]);
  assert.deepEqual(filterDispatches(items, { query: "资料", project: "控制台" }), []);
  assert.deepEqual(filterDispatches(items, { project: "文献库" }).map((item) => item.id), ["2"]);
});

test("dispatch scheduling presents bounded relative time and editable local values", () => {
  const now = new Date("2026-09-03T10:00:00.000Z");
  assert.equal(scheduleRelativeLabel("2026-09-03T10:25:00.000Z", now), "25 分钟后");
  assert.equal(scheduleRelativeLabel("2026-09-03T12:01:00.000Z", now), "3 小时后");
  assert.equal(scheduleRelativeLabel("2026-09-05T10:00:00.000Z", now), "2 天后");
  assert.equal(scheduleRelativeLabel("2026-09-03T09:00:00.000Z", now), "即将进入队列");
  assert.match(localDateTimeValue("2026-09-03T10:00:00.000Z"), /^2026-09-03T\d{2}:00$/);
});
