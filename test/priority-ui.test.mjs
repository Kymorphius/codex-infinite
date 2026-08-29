import test from "node:test";
import assert from "node:assert/strict";
import { priorityMetrics } from "../public/features/priority/index.js";

test("priority metrics aggregate recent sessions without inventing unavailable data", () => {
  const projects = [{ recentSessionCount: 3 }, { recentSessionCount: 2 }, {}];
  assert.deepEqual(priorityMetrics(projects), { projectCount: "3", recentCount: "5", source: "本机记录" });
  assert.deepEqual(priorityMetrics(projects, false), { projectCount: "—", recentCount: "—", source: "不可用" });
});
