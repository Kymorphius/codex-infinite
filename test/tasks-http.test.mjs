import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardServer } from "../src/http-server.mjs";

function config() {
  return {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: "/tmp/codex-tasks-http-test"
  };
}

async function start(t) {
  const calls = [];
  const task = { id: "thread/one", title: "Demo", project: "demo" };
  const adapter = {
    async listTasks() { calls.push(["list"]); return { status: "connected", tasks: [task], projects: ["demo"] }; },
    async getTask(id) { calls.push(["get", id]); return id === task.id ? task : null; },
    async getActivity(id, deviceId) { calls.push(["activity", id, deviceId]); return id === task.id && deviceId === "remote" ? { schemaVersion: 1, threadId: id, entries: [] } : null; }
  };
  const localTask = { id: "local-one", title: "Local", status: "active", project: "local", sourceFile: "/private/session.jsonl" };
  const localAdapter = {
    device: { id: "local" },
    async listTasks() { calls.push(["local-list"]); return { status: "connected", tasks: [localTask], devices: [{ id: "local", name: "Local" }] }; },
    async getTask(id) { return id === localTask.id ? localTask : null; },
    async getActivity(id) { calls.push(["local-activity", id]); return id === localTask.id ? { schemaVersion: 1, threadId: id, entries: [] } : null; }
  };
  const remoteMessageService = { async readDraft(id) { calls.push(["draft", id]); return { text: "owner draft", revision: "a".repeat(64) }; } };
  const dashboard = createDashboardServer({ config: config(), adapter, local: localAdapter, remoteMessageService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  return { calls, request: (pathname, options = {}) => fetch(`${origin}${pathname}`, options) };
}

test("task routes preserve collection, encoded item, HEAD, and missing behavior", async (t) => {
  const { calls, request } = await start(t);
  const listed = await request("/api/tasks");
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).tasks[0].id, "thread/one");

  const item = await request("/api/tasks/thread%2Fone");
  assert.equal(item.status, 200);
  assert.equal((await item.json()).task.title, "Demo");
  const head = await request("/api/tasks", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await request("/api/tasks/missing")).status, 404);
  assert.deepEqual(calls, [["list"], ["get", "thread/one"], ["list"], ["get", "missing"]]);
});

test("task routes reject unsupported methods and malformed identifiers", async (t) => {
  const { calls, request } = await start(t);
  assert.equal((await request("/api/tasks", { method: "POST" })).status, 405);
  assert.equal((await request("/api/tasks/%ZZ")).status, 400);
  assert.deepEqual(calls, []);
});

test("node snapshot is local-only, bounded, and excludes filesystem paths", async (t) => {
  const { calls, request } = await start(t);
  const response = await request("/api/node/snapshot");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.tasks[0].id, "local-one");
  assert.equal(result.tasks[0].sourceFile, undefined);
  assert.deepEqual(calls, [["local-list"]]);
  assert.equal((await request("/api/node/snapshot", { method: "POST" })).status, 405);
});

test("activity routes preserve explicit owner identity and local-only node export", async (t) => {
  const { calls, request } = await start(t);
  const owner = await request("/api/node/activity/local-one");
  assert.equal(owner.status, 200);
  const ownerActivity = await owner.json();
  assert.equal(ownerActivity.schemaVersion, 1);
  assert.equal(ownerActivity.draft.text, "owner draft");
  const remote = await request("/api/tasks/thread%2Fone/activity?device=remote");
  assert.equal(remote.status, 200);
  assert.equal((await remote.json()).activity.threadId, "thread/one");
  assert.equal((await request("/api/tasks/thread%2Fone/activity")).status, 400);
  assert.equal((await request("/api/node/activity/%3Bbad")).status, 400);
  assert.equal((await request("/api/node/activity/local-one", { method: "POST" })).status, 405);
  assert.deepEqual(calls, [["local-activity", "local-one"], ["draft", "local-one"], ["activity", "thread/one", "remote"]]);
});
