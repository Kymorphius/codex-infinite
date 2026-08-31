import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/http-server.mjs";
import { ContextWindowStore, ModelCatalog } from "../src/context-window.mjs";

test("context override API is origin-protected and reports model clamping", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-context-http-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const modelPath = path.join(directory, "models.json");
  await fs.writeFile(modelPath, JSON.stringify({ models: [{ slug: "gpt-5.6-sol", context_window: 272000, max_context_window: 872000, effective_context_window_percent: 95 }] }));
  const contextWindowStore = new ContextWindowStore({ filePath: path.join(directory, "overrides.json") });
  await contextWindowStore.init();
  const task = {
    id: "01a015ac-363f-7472-961a-f31d174ad2c8",
    title: "Demo thread",
    project: "demo",
    model: "gpt-5.6-sol",
    modelContextWindow: 258400
  };
  const adapter = { async listTasks() { return { status: "connected", tasks: [task], projects: [] }; }, async getTask(id) { return id === task.id ? task : null; } };
  const config = {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: directory
  };
  const dashboard = createDashboardServer({ config, adapter, contextWindowStore, modelCatalog: new ModelCatalog({ filePath: modelPath }) });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const pathname = `/api/context-overrides/${task.id}`;
  const body = JSON.stringify({ contextWindow: 1_000_000 });

  const missingOrigin = await fetch(`${origin}${pathname}`, { method: "PUT", headers: { "content-type": "application/json" }, body });
  assert.equal(missingOrigin.status, 403);
  const missingContentType = await fetch(`${origin}${pathname}`, { method: "PUT", headers: { origin: config.dashboardOrigin }, body });
  assert.equal(missingContentType.status, 415);
  const saved = await fetch(`${origin}${pathname}`, { method: "PUT", headers: { "content-type": "application/json", origin: config.dashboardOrigin }, body });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.item.acceptedContextWindow, 872_000);
  assert.equal(savedBody.item.estimatedEffectiveContextWindow, 828_400);

  const listed = await fetch(`${origin}/api/context-overrides`);
  assert.equal(listed.status, 200);
  assert.equal((await listed.json()).items[0].requestedContextWindow, 1_000_000);
  assert.equal((await fetch(`${origin}${pathname}`, { method: "DELETE" })).status, 403);
  assert.equal((await fetch(`${origin}${pathname}`, { method: "DELETE", headers: { origin: config.dashboardOrigin } })).status, 200);
  assert.equal((await fetch(`${origin}${pathname}`, { method: "DELETE", headers: { origin: config.dashboardOrigin } })).status, 404);
});
