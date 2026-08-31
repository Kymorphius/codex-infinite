import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionTitleIndex, parseSessionTitleIndex } from "../src/session-title-index.mjs";
import { CodexTaskAdapter } from "../src/task-adapter.mjs";

test("session title index uses the latest valid user-renamed title", () => {
  const titles = parseSessionTitleIndex([
    JSON.stringify({ id: "thread-1", thread_name: "最开始的名字" }),
    "malformed",
    JSON.stringify({ id: "thread-1", thread_name: "用户后来改过的名字" }),
    JSON.stringify({ id: "thread-2", thread_name: "" })
  ].join("\n"));
  assert.equal(titles.get("thread-1"), "用户后来改过的名字");
  assert.equal(titles.has("thread-2"), false);
});

test("session title index safely treats a missing file as empty", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "session-title-index-"));
  try {
    const index = new SessionTitleIndex({ filePath: path.join(directory, "missing.jsonl") });
    assert.deepEqual([...await index.read()], []);
    const filePath = path.join(directory, "session_index.jsonl");
    await writeFile(filePath, JSON.stringify({ id: "thread-1", thread_name: "当前标题" }));
    assert.equal((await new SessionTitleIndex({ filePath }).read()).get("thread-1"), "当前标题");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("task listing prefers the current Codex title over the creation request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "renamed-session-"));
  try {
    const sessionRoot = path.join(directory, "sessions");
    await mkdir(sessionRoot);
    await writeFile(path.join(sessionRoot, "thread-1.jsonl"), [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-31T10:00:00Z", payload: { id: "thread-1", cwd: "/tmp/demo" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-08-31T10:00:01Z", payload: { type: "user_message", message: "最开始的请求" } })
    ].join("\n"));
    const indexPath = path.join(directory, "session_index.jsonl");
    await writeFile(indexPath, JSON.stringify({ id: "thread-1", thread_name: "用户改过的标题" }));
    const adapter = new CodexTaskAdapter({ sessionRoot, titleIndex: new SessionTitleIndex({ filePath: indexPath }) });
    assert.equal((await adapter.listTasks()).tasks[0].title, "用户改过的标题");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("task listing prefers native desktop runtime status over stale rollout status", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "native-session-status-"));
  try {
    const sessionRoot = path.join(directory, "sessions");
    await mkdir(sessionRoot);
    const id = "01a0299b-b536-7a11-8526-9b5ef4491a92";
    await writeFile(path.join(sessionRoot, `${id}.jsonl`), [
      JSON.stringify({ type: "session_meta", timestamp: "2026-08-31T10:00:00Z", payload: { id, cwd: "/tmp/demo" } }),
      JSON.stringify({ type: "event_msg", timestamp: "2026-08-31T10:00:01Z", payload: { type: "task_complete" } })
    ].join("\n"));
    const runtimeStatusProvider = { async readThreadStatuses() { return new Map([[id, "active"]]); } };
    const adapter = new CodexTaskAdapter({ sessionRoot, runtimeStatusProvider });
    assert.equal((await adapter.listTasks()).tasks[0].status, "active");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
