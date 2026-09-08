import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DispatchAuditStore } from "../src/dispatch-audit.mjs";
import { DispatchBoardStore, normalizeDispatchChanges } from "../src/dispatch-board.mjs";

test("in-flight restart becomes delivery unknown and requires an explicit new attempt", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-audit-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const boardPath = path.join(directory, "board.json");
  const audit = new DispatchAuditStore({ filePath: path.join(directory, "audit.jsonl"), idFactory: () => "event-1" });
  await fs.writeFile(boardPath, JSON.stringify({ version: 1, items: [{
    id: "dispatch-1", title: "任务", prompt: "敏感任务内容", project: "demo",
    targetThreadId: "thread-1", targetThreadTitle: "Demo", cwd: "/private/project",
    status: "sending", attemptCount: 1, activeAttemptId: "attempt-old",
    createdAt: "2026-09-04T01:00:00.000Z", updatedAt: "2026-09-04T01:01:00.000Z",
    startedAt: "2026-09-04T01:01:00.000Z", completedAt: null, lastError: null
  }] }));
  const store = new DispatchBoardStore({
    filePath: boardPath, auditStore: audit, now: () => new Date("2026-09-04T02:00:00.000Z"),
    attemptIdFactory: () => "attempt-new"
  });

  await store.init();
  assert.equal(store.get("dispatch-1").status, "delivery_unknown");
  assert.equal(await store.claimNext(), null);
  assert.throws(() => normalizeDispatchChanges(store.get("dispatch-1"), { status: "delivery_unknown" }), /不能手动设置/);

  await store.update("dispatch-1", { status: "queued" });
  const claimed = await store.claimNext();
  assert.equal(claimed.attemptCount, 2);
  assert.equal(claimed.activeAttemptId, "attempt-new");
  assert.equal(await store.finish("dispatch-1", { ok: true }), null);
  assert.equal(await store.finish("dispatch-1", { ok: true, attemptId: "attempt-old" }), null);
  assert.equal(store.get("dispatch-1").status, "sending");
  assert.equal((await store.finish("dispatch-1", { ok: true, attemptId: "attempt-new" })).status, "sent");

  const events = await audit.list("dispatch-1");
  assert.deepEqual(events.map((event) => event.type), ["delivery_unknown", "retry_requested", "claimed", "completed"]);
  const rawAudit = await fs.readFile(path.join(directory, "audit.jsonl"), "utf8");
  assert.doesNotMatch(rawAudit, /敏感任务内容|private\/project/);
  assert.equal(JSON.parse(await fs.readFile(boardPath, "utf8")).version, 2);
});

test("audit failures degrade diagnostics without blocking authoritative task state", async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-dispatch-audit-failure-"));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const audit = new DispatchAuditStore({ filePath: directory });
  const store = new DispatchBoardStore({ filePath: path.join(directory, "board.json"), auditStore: audit, idFactory: () => "dispatch-1" });
  await store.init();
  const item = await store.create({ title: "任务", prompt: "执行", project: "demo", targetThreadId: "thread-1", mode: "backlog" });
  assert.equal(item.status, "backlog");
  assert.equal(audit.diagnostics().status, "degraded");
});
