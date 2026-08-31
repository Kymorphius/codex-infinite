import test from "node:test";
import assert from "node:assert/strict";
import { boardStatusFromTaskStatus, enrichTaskForBoard, projectNameFromCwd } from "../src/board.mjs";

test("project name is derived from the final cwd segment", () => {
  assert.equal(projectNameFromCwd("/Users/matrix/333.dev/mulitca"), "mulitca");
  assert.equal(projectNameFromCwd("C:\\work\\control-console\\"), "control-console");
  assert.equal(projectNameFromCwd("/"), "未归类");
  assert.equal(projectNameFromCwd(null), "未归类");
});

test("board status maps task states to the four read-only columns", () => {
  assert.equal(boardStatusFromTaskStatus("active"), "active");
  assert.equal(boardStatusFromTaskStatus("completed"), "completed");
  assert.equal(boardStatusFromTaskStatus("error"), "error");
  assert.equal(boardStatusFromTaskStatus("interrupted"), "error");
  assert.equal(boardStatusFromTaskStatus("unknown"), "pending");
  assert.equal(boardStatusFromTaskStatus("future-state"), "pending");
});

test("board enrichment preserves truthful task data and adds derived fields", () => {
  const task = enrichTaskForBoard({ id: "task-1", title: "Demo", status: "interrupted", cwd: "/tmp/demo" });
  assert.deepEqual(task, {
    id: "task-1",
    title: "Demo",
    status: "interrupted",
    cwd: "/tmp/demo",
    project: "demo",
    boardStatus: "error"
  });
});
