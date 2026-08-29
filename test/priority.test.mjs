import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectPriorities, calculateProjectPriority } from "../src/priority.mjs";

const now = new Date("2026-08-13T12:00:00.000Z");

test("a recently updated conversation adds more recency weight", () => {
  const recent = calculateProjectPriority([{ createdAt: "2026-08-13T10:00:00.000Z", updatedAt: "2026-08-13T11:00:00.000Z", status: "completed" }], now);
  const old = calculateProjectPriority([{ createdAt: "2026-07-01T10:00:00.000Z", updatedAt: "2026-07-01T11:00:00.000Z", status: "completed" }], now);
  assert.ok(recent.recencyWeight > old.recencyWeight);
  assert.equal(recent.recentSessionCount, 1);
  assert.equal(old.recentSessionCount, 0);
});

test("longer runtime increases runtime weight without exceeding its cap", () => {
  const short = calculateProjectPriority([{ createdAt: "2026-08-13T10:00:00.000Z", updatedAt: "2026-08-13T11:00:00.000Z", status: "completed" }], now);
  const long = calculateProjectPriority([{ createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-13T11:00:00.000Z", status: "completed" }], now);
  assert.ok(long.runtimeWeight > short.runtimeWeight);
  assert.ok(long.runtimeWeight <= 15);
});

test("the latest conversation dominates historical runtime", () => {
  const projects = buildProjectPriorities([
    { id: "historical", title: "Historical", project: "large-old-project", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-08-11T12:00:00.000Z", status: "completed" },
    { id: "recent", title: "Recent", project: "small-recent-project", createdAt: "2026-08-13T10:00:00.000Z", updatedAt: "2026-08-13T11:30:00.000Z", status: "completed" }
  ], now);
  assert.equal(projects[0].project, "small-recent-project");
  assert.ok(projects[0].priorityScore > projects[1].priorityScore);
});

test("projects are grouped and ordered by transparent priority score", () => {
  const projects = buildProjectPriorities([
    { id: "old", title: "Old task", project: "archive", createdAt: "2026-07-01T10:00:00.000Z", updatedAt: "2026-07-01T11:00:00.000Z", status: "completed" },
    { id: "new-1", title: "Latest task", project: "current", createdAt: "2026-08-13T09:00:00.000Z", updatedAt: "2026-08-13T11:30:00.000Z", status: "active" },
    { id: "new-2", title: "Another task", project: "current", createdAt: "2026-08-12T09:00:00.000Z", updatedAt: "2026-08-12T11:30:00.000Z", status: "completed" }
  ], now);
  assert.equal(projects[0].project, "current");
  assert.equal(projects[0].taskCount, 2);
  assert.equal(projects[0].activeTaskCount, 1);
  assert.deepEqual(projects[0].latestTask, { id: "new-1", title: "Latest task" });
  assert.ok(projects[0].priorityScore > projects[1].priorityScore);
});
