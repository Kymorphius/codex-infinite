import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionDevice, parseSessionJsonl } from "../src/task-adapter.mjs";
import { resolveDispatchTarget } from "../src/dispatch-http.mjs";

test("session adapter extracts truthful task metadata without requiring app internals", () => {
  const content = [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-13T01:00:00.000Z", payload: { id: "task-123", cwd: "/tmp/project", timestamp: "2026-08-13T01:00:00.000Z" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:01:00.000Z", payload: { type: "task_started" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:02:00.000Z", payload: { type: "user_message", message: "  Build the console\nwith a read-only adapter  " } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-08-13T01:03:00.000Z", payload: { type: "task_complete" } })
  ].join("\n");
  const task = parseSessionJsonl(content, "/tmp/task-123.jsonl");
  assert.deepEqual({ id: task.id, title: task.title, status: task.status, cwd: task.cwd }, {
    id: "task-123",
    title: "Build the console with a read-only adapter",
    status: "completed",
    cwd: "/tmp/project"
  });
});

test("session devices preserve the provider boundary needed by remote Codex nodes", () => {
  assert.deepEqual(normalizeSessionDevice({
    id: "linux:studio",
    name: "Studio Linux",
    kind: "codekanban-agent",
    location: "远程 Linux",
    status: "connected"
  }), {
    id: "linux:studio",
    name: "Studio Linux",
    kind: "codekanban-agent",
    location: "远程 Linux",
    status: "connected"
  });
});

test("project dispatch defaults to that project's latest conversation", () => {
  const tasks = [
    { id: "new", project: "demo", updatedAt: "2026-08-13T12:00:00Z" },
    { id: "old", project: "demo", updatedAt: "2026-08-12T12:00:00Z" },
    { id: "other", project: "other" }
  ];
  assert.equal(resolveDispatchTarget(tasks, { project: "demo" }).id, "new");
  assert.equal(resolveDispatchTarget(tasks, { project: "demo", targetThreadId: "old" }).id, "old");
  assert.equal(resolveDispatchTarget(tasks, { project: "demo", targetThreadId: "other" }), null);
});
