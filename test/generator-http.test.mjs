import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardServer } from "../src/http-server.mjs";
import { resolveGeneratorTasks } from "../src/generator-http.mjs";

const dashboardConfig = {
  dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
  cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: "/tmp/generator-http"
};

function service() {
  const generators = [];
  const runs = [];
  return {
    list() { return { generators, runs }; },
    async create(input) { const item = { id: "generator-1", ...input }; generators.push(item); return item; },
    async triggerManual(id, requestId) { if (!generators.some((item) => item.id === id)) return null; const run = { id: "run-1", requestId }; runs.push(run); return run; },
    async remove(id) { const index = generators.findIndex((item) => item.id === id); if (index < 0) return false; generators.splice(index, 1); return true; }
  };
}

async function start(t, generatorService = service()) {
  const tasks = [
    { id: "thread-1", project: "demo", title: "最近对话", cwd: "/verified/demo" },
    { id: "thread-2", project: "demo", title: "旧对话", cwd: "/verified/demo" }
  ];
  const adapter = { async listTasks() { return { status: "connected", tasks }; }, async getTask() { return null; } };
  const dashboard = createDashboardServer({ config: dashboardConfig, adapter, generatorService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  return (pathname, options = {}) => fetch(`${origin}${pathname}`, options);
}

test("generator target resolution trusts indexed local paths and distinguishes new conversations", () => {
  const tasks = [{ id: "thread-1", project: "demo", title: "Demo", cwd: "/verified" }];
  const [existing, created] = resolveGeneratorTasks(tasks, [
    { action: "existing_thread", project: "demo", targetThreadId: "thread-1", cwd: "/forged" },
    { action: "new_thread", project: "demo", cwd: "/forged" }
  ]);
  assert.equal(existing.cwd, "/verified");
  assert.equal(existing.targetThreadTitle, "Demo");
  assert.equal(created.cwd, "/verified");
  assert.equal(created.targetThreadId, null);
  assert.throws(() => resolveGeneratorTasks(tasks, [{ action: "new_thread", project: "missing" }]), /没有可用的本机会话/);
});

test("generator HTTP routes create, list, trigger, and remove with exact-origin mutations", async (t) => {
  const request = await start(t);
  const headers = { origin: dashboardConfig.dashboardOrigin, "content-type": "application/json" };
  const body = { name: "发布", tasks: [{ action: "new_thread", title: "检查", prompt: "运行测试", project: "demo", cwd: "/forged" }] };
  const created = await request("/api/generators", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).item.tasks[0].cwd, "/verified/demo");
  assert.equal((await request("/api/generators")).status, 200);
  const triggered = await request("/api/generators/generator-1/trigger", { method: "POST", headers, body: JSON.stringify({ requestId: "request-1" }) });
  assert.equal(triggered.status, 202);
  assert.equal((await triggered.json()).run.id, "run-1");
  assert.equal((await request("/api/generators/generator-1", { method: "DELETE", headers: { origin: dashboardConfig.dashboardOrigin } })).status, 200);
});

test("generator mutations reject missing trust boundaries and unavailable service", async (t) => {
  const request = await start(t);
  const body = JSON.stringify({ name: "发布", tasks: [{ action: "new_thread", title: "检查", prompt: "运行", project: "demo" }] });
  assert.equal((await request("/api/generators", { method: "POST", headers: { "content-type": "application/json" }, body })).status, 403);
  assert.equal((await request("/api/generators", { method: "POST", headers: { origin: dashboardConfig.dashboardOrigin }, body })).status, 415);
  const invalidAction = JSON.stringify({ name: "发布", tasks: [{ action: "unknown", title: "检查", prompt: "运行", project: "demo" }] });
  assert.equal((await request("/api/generators", { method: "POST", headers: { origin: dashboardConfig.dashboardOrigin, "content-type": "application/json" }, body: invalidAction })).status, 400);
  assert.equal((await request("/api/generators/missing/trigger", { method: "POST", headers: { origin: dashboardConfig.dashboardOrigin, "content-type": "application/json" }, body: JSON.stringify({ requestId: "request" }) })).status, 404);
  assert.equal((await request("/api/generators/%ZZ", { method: "DELETE", headers: { origin: dashboardConfig.dashboardOrigin } })).status, 400);

  const unavailable = await start(t, null);
  assert.equal((await unavailable("/api/generators")).status, 503);
});
