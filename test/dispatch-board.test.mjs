import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DispatchBoardStore, initialDispatchStatus, validateDispatchInput } from "../src/dispatch-board.mjs";

test("dispatch validation requires a real project conversation target", () => {
  assert.throws(() => validateDispatchInput({ title: "任务", prompt: "执行", project: "demo" }), /目标项目没有可用对话/);
  assert.equal(initialDispatchStatus({ mode: "backlog" }), "backlog");
  assert.equal(initialDispatchStatus({ mode: "queue" }), "queued");
});

test("scheduled dispatch persists and becomes queued when due", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-test-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  let current = new Date("2026-08-13T10:00:00.000Z");
  const store = new DispatchBoardStore({ filePath: path.join(directory, "board.json"), now: () => current, idFactory: () => "dispatch-1" });
  await store.init();
  const item = await store.create({
    title: "安排检查",
    prompt: "运行测试并报告",
    project: "demo",
    targetThreadId: "thread-1",
    targetThreadTitle: "Demo thread",
    cwd: "/tmp/demo",
    scheduledAt: "2026-08-13T11:00:00.000Z",
    mode: "schedule"
  });
  assert.equal(item.status, "scheduled");
  current = new Date("2026-08-13T11:01:00.000Z");
  await store.promoteDue();
  assert.equal(store.list()[0].status, "queued");
  const reloaded = new DispatchBoardStore({ filePath: path.join(directory, "board.json") });
  await reloaded.init();
  assert.equal(reloaded.list()[0].targetThreadId, "thread-1");
});
