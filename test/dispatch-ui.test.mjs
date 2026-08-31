import test from "node:test";
import assert from "node:assert/strict";
import { destinationProjectNames, dispatchColumnStatus, dispatchMetrics } from "../public/features/dispatch/index.js";

test("dispatch UI groups cancelled work with failures and reports truthful metrics", () => {
  const items = [
    { id: "1", status: "queued", targetThreadId: "thread-a" },
    { id: "2", status: "sending", targetThreadId: "thread-a" },
    { id: "3", status: "cancelled", targetThreadId: "thread-b" }
  ];
  assert.equal(dispatchColumnStatus("cancelled"), "failed");
  assert.equal(dispatchColumnStatus("sent"), "sent");
  assert.deepEqual(dispatchMetrics(items), { count: 3, waitingCount: 2, targetCount: 2 });
});

test("dispatch destinations are unique, sorted, and retain unclassified tasks", () => {
  assert.deepEqual(destinationProjectNames([
    { project: "beta" }, { project: "alpha" }, { project: "beta" }, {}
  ]), ["未归类", "alpha", "beta"]);
});
