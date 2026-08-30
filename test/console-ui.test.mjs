import test from "node:test";
import assert from "node:assert/strict";
import { consoleMetrics } from "../public/features/console/index.js";

test("console metrics distinguish connected task data from unavailable state", () => {
  assert.deepEqual(consoleMetrics([{}, {}]), { count: "2", source: "节点记录" });
  assert.deepEqual(consoleMetrics([{}, {}], false), { count: "—", source: "不可用" });
});
