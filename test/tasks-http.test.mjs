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
    async getTask(id) { calls.push(["get", id]); return id === task.id ? task : null; }
  };
  const dashboard = createDashboardServer({ config: config(), adapter });
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
