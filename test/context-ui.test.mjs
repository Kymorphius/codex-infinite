import test from "node:test";
import assert from "node:assert/strict";
import { contextMetrics } from "../public/features/context/index.js";

test("context UI metrics distinguish saved overrides from unavailable data", () => {
  const items = [
    { requestedContextWindow: 1_000_000 },
    { requestedContextWindow: 500_000 },
    { requestedContextWindow: 1_200_000 }
  ];
  assert.deepEqual(contextMetrics(items), { count: "3", millionCount: "2" });
  assert.deepEqual(contextMetrics(items, false), { count: "—", millionCount: "—" });
});
