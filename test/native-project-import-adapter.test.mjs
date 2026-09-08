import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { NativeProjectImportAdapter } from "../src/native-project-import-adapter.mjs";

function fakeServer(requests, { failImport = false, threadPath = null } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.toString());
      requests.push(request);
      let result = {};
      let error = null;
      if (request.method === "thread/read") result = { thread: { path: threadPath } };
      if (request.method === "project/list") result = { data: [], nextCursor: null };
      if (request.method === "project/import") failImport ? error = { message: "import failed" } : result = { project: { id: "project-local" } };
      if (request.method === "threadSection/list") result = { data: [{ id: "collaboration-section", name: "协同" }] };
      queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: request.id, ...(error ? { error } : { result }) })}\n`));
      callback();
    } });
    child.kill = () => { child.emit("exit", 0); return true; };
    return child;
  };
}

test("native project import rekeys complete rollout history and binds one project", async () => {
  const requests = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-import-"));
  const source = path.join(root, "source.jsonl");
  const userItem = { timestamp: "2026-09-01T11:38:00.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "继续" }] } };
  await fs.writeFile(source, `${JSON.stringify({ timestamp: "2026-09-01T11:37:34.728Z", type: "session_meta", payload: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cwd: "C:\\old", timestamp: "2026-09-01T11:37:34.019Z" } })}\n${JSON.stringify(userItem)}\n`);
  const localThreadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const stagedPath = path.join(root, "sessions", "2026", "09", "01", `rollout-2026-09-01T11-37-34-${localThreadId}.jsonl`);
  let registered;
  const adapter = new NativeProjectImportAdapter({ codexPath: "/codex", codexHome: root, sessionRoot: path.join(root, "sessions"), sidebarRegistry: { async register(value) { registered = value; return { projectId: "sidebar-project" }; } }, spawnImpl: fakeServer(requests, { threadPath: stagedPath }), timeoutMs: 1000, idFactory: () => localThreadId });
  const result = await adapter.import({
    sessions: [{ sourceThreadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path: source, title: "任务 aaaaaaaa" }],
    destinationDirectory: "/work/copied", projectName: "Copied", idempotencyKey: "copy-id"
  });
  assert.equal(result.projectId, "project-local");
  assert.equal(result.sidebarProjectId, "sidebar-project");
  assert.notEqual(result.conversations[0].localThreadId, result.conversations[0].sourceThreadId);
  assert.equal(requests.some((request) => request.method === "thread/fork"), false);
  assert.deepEqual(requests.find((request) => request.method === "thread/name/set").params, { threadId: localThreadId, name: "任务 aaaaaaaa" });
  const cloned = (await fs.readFile(stagedPath, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(cloned[0].payload.id, localThreadId);
  assert.equal(cloned[0].payload.session_id, localThreadId);
  assert.equal(cloned[0].payload.cwd, "/work/copied");
  assert.deepEqual(cloned[1], userItem);
  assert.deepEqual(requests.find((request) => request.method === "project/import").params.threads, [result.conversations[0].localThreadId]);
  assert.deepEqual(requests.find((request) => request.method === "thread/section/move").params, { threadId: result.conversations[0].localThreadId, sectionId: null });
  assert.deepEqual(registered, { serverProjectId: "project-local", projectName: "Copied", rootPath: "/work/copied", threadIds: [result.conversations[0].localThreadId], collaborationSectionId: "collaboration-section" });
  assert.equal(requests.some((request) => request.method === "thread/archive"), false);
  await fs.access(stagedPath);
  await fs.rm(root, { recursive: true, force: true });
});

test("failed project import deletes the rekeyed local conversation", async () => {
  const requests = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-import-fail-"));
  const source = path.join(root, "source.jsonl");
  await fs.writeFile(source, `${JSON.stringify({ timestamp: "2026-09-01T11:37:34.728Z", type: "session_meta", payload: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", timestamp: "2026-09-01T11:37:34.019Z" } })}\n`);
  const localThreadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const stagedPath = path.join(root, "sessions", "2026", "09", "01", `rollout-2026-09-01T11-37-34-${localThreadId}.jsonl`);
  const adapter = new NativeProjectImportAdapter({ codexPath: "/codex", codexHome: root, sessionRoot: path.join(root, "sessions"), spawnImpl: fakeServer(requests, { failImport: true, threadPath: stagedPath }), timeoutMs: 1000, idFactory: () => localThreadId });
  await assert.rejects(adapter.import({ sessions: [{ sourceThreadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path: source }], destinationDirectory: "/work", projectName: "Work", idempotencyKey: "copy" }), /import failed/);
  assert.equal(requests.some((request) => request.method === "thread/delete" && request.params.threadId === localThreadId), true);
  await assert.rejects(fs.access(stagedPath));
  await fs.rm(root, { recursive: true, force: true });
});
