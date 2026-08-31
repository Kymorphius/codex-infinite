import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardServer } from "../src/http-server.mjs";

function config() {
  return {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: "/tmp/codex-dispatch-http-test"
  };
}

async function start(t, { dispatchStore } = {}) {
  const tasks = [{ id: "thread-1", project: "demo", title: "Demo", cwd: "/tmp/demo" }];
  const adapter = {
    async listTasks() { return { status: "connected", tasks, projects: [] }; },
    async getTask(id) { return tasks.find((task) => task.id === id) || null; }
  };
  const dashboard = createDashboardServer({ config: config(), adapter, dispatchStore });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  return (pathname, options = {}) => fetch(`${origin}${pathname}`, options);
}

function memoryDispatchStore() {
  const items = new Map();
  return {
    list() { return [...items.values()]; },
    async create(input) { const item = { id: "dispatch-1", status: "queued", ...input }; items.set(item.id, item); return item; },
    async update(id, patch) { const item = items.get(id); if (!item) return null; const updated = { ...item, ...patch }; items.set(id, updated); return updated; },
    async remove(id) { return items.delete(id); }
  };
}

test("dispatch HTTP routes preserve create, list, update, and remove contracts", async (t) => {
  const request = await start(t, { dispatchStore: memoryDispatchStore() });
  const headers = { origin: config().dashboardOrigin, "content-type": "application/json" };
  const created = await request("/api/dispatches", {
    method: "POST", headers, body: JSON.stringify({ title: "Check", prompt: "Run tests", project: "demo", mode: "queue" })
  });
  assert.equal(created.status, 201);
  const createdItem = (await created.json()).item;
  assert.equal(createdItem.targetThreadId, "thread-1");
  assert.equal(createdItem.targetThreadTitle, "Demo");
  assert.equal(createdItem.cwd, "/tmp/demo");

  const listed = await request("/api/dispatches");
  assert.equal((await listed.json()).items.length, 1);
  const updated = await request("/api/dispatches/dispatch-1", { method: "PATCH", headers, body: JSON.stringify({ status: "backlog" }) });
  assert.equal((await updated.json()).item.status, "backlog");
  assert.equal((await request("/api/dispatches/dispatch-1", { method: "DELETE", headers: { origin: config().dashboardOrigin } })).status, 200);
  assert.equal((await request("/api/dispatches/dispatch-1", { method: "DELETE", headers: { origin: config().dashboardOrigin } })).status, 404);
});

test("dispatch mutations fail closed on origin, content type, and body limits", async (t) => {
  const request = await start(t, { dispatchStore: memoryDispatchStore() });
  const body = JSON.stringify({ title: "Check", prompt: "Run", project: "demo" });
  assert.equal((await request("/api/dispatches", { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403);
  assert.equal((await request("/api/dispatches", { method: "POST", headers: { origin: config().dashboardOrigin }, body })).status, 415);
  assert.equal((await request("/api/dispatches", {
    method: "POST", headers: { origin: config().dashboardOrigin, "content-type": "application/json" }, body: "{"
  })).status, 400);
  assert.equal((await request("/api/dispatches", {
    method: "POST", headers: { origin: config().dashboardOrigin, "content-type": "application/json" }, body: JSON.stringify({ padding: "x".repeat(70 * 1024) })
  })).status, 413);
  assert.equal((await request("/api/dispatches/%ZZ", {
    method: "DELETE", headers: { origin: config().dashboardOrigin }
  })).status, 400);
  assert.equal((await request("/api/dispatches", { method: "PUT" })).status, 405);
});

test("dispatch routes report unavailable service and missing targets truthfully", async (t) => {
  const unavailable = await start(t);
  assert.equal((await unavailable("/api/dispatches")).status, 503);

  const request = await start(t, { dispatchStore: memoryDispatchStore() });
  const missing = await request("/api/dispatches", {
    method: "POST",
    headers: { origin: config().dashboardOrigin, "content-type": "application/json" },
    body: JSON.stringify({ title: "Check", prompt: "Run", project: "missing" })
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).message, "所选项目或目标对话不可用");
});
