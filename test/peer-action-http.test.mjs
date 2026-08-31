import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/http-server.mjs";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";

test("browser remote messages require exact origin and owner actions require a non-replayed signature", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-action-http-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 5);
  const keyPath = path.join(directory, "node-action.key");
  await fs.writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  const calls = [];
  const config = {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpPort: 9231, cdpOrigin: "http://127.0.0.1:9231", profileDirectory: directory, nodeActionKeyPath: keyPath
  };
  const adapter = {
    async listTasks() { return { status: "empty", tasks: [], projects: [], devices: [] }; },
    async sendMessage(id, device, prompt, revision) { calls.push(["route", id, device, prompt, revision]); return { accepted: true, transport: "direct-ssh" }; },
    async control(id, device, input) { calls.push(["control-route", id, device, input.action, input.turnId]); return { accepted: true, interrupted: input.action === "interrupt", approvalResolved: input.action === "resolveApproval" }; },
    async updateSettings(id, device, changes) { calls.push(["settings-route", id, device, changes]); return { accepted: true, settings: { reasoningEffort: changes.reasoningEffort } }; }
  };
  const remoteMessageService = {
    async submit(input) { calls.push(["owner", input.threadId, input.prompt]); return { accepted: true, requestId: "request-1" }; },
    async control(input) { calls.push(["control-owner", input.threadId, input.turnId, input.action]); return { accepted: true, interrupted: input.action === "interrupt", approvalResolved: input.action === "resolveApproval" }; }
  };
  const remoteThreadSettingsService = {
    async update(input) { calls.push(["settings-owner", input.threadId, input.changes]); return { accepted: true, effectiveFrom: "next-turn" }; }
  };
  const dashboard = createDashboardServer({ config, adapter, local: adapter, remoteMessageService, remoteThreadSettingsService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const browserBody = JSON.stringify({ prompt: "continue remotely" });
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/messages?device=forest-mac`, { method: "POST", headers: { "content-type": "application/json" }, body: browserBody })).status, 403);
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/messages?device=forest-mac`, { method: "POST", headers: { origin: config.dashboardOrigin, "content-type": "application/json" }, body: browserBody })).status, 202);
  const browserControl = JSON.stringify({ action: "interrupt", turnId: "01a04446-8d03-7243-a4d3-181180bb626e" });
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/control?device=forest-mac`, { method: "POST", headers: { "content-type": "application/json" }, body: browserControl })).status, 403);
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/control?device=forest-mac`, { method: "POST", headers: { origin: config.dashboardOrigin, "content-type": "application/json" }, body: browserControl })).status, 202);
  const browserApproval = JSON.stringify({ action: "resolveApproval", turnId: "01a04446-8d03-7243-a4d3-181180bb626e", approvalToken: "01a04447-8d03-7243-a4d3-181180bb626f", decision: "accept" });
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/control?device=forest-mac`, { method: "POST", headers: { origin: config.dashboardOrigin, "content-type": "application/json" }, body: browserApproval })).status, 202);
  const browserSettings = JSON.stringify({ changes: { reasoningEffort: "high" } });
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/settings?device=forest-mac`, { method: "POST", headers: { "content-type": "application/json" }, body: browserSettings })).status, 403);
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/settings?device=forest-mac`, { method: "POST", headers: { origin: config.dashboardOrigin, "content-type": "application/json" }, body: browserSettings })).status, 202);

  const ownerPath = "/api/node/actions/message";
  const ownerBody = Buffer.from(JSON.stringify({ threadId: "thread-1", prompt: "owner executes" }));
  const timestamp = String(Date.now());
  const nonce = "nonce_1234567890123456";
  const headers = {
    "content-type": "application/json",
    [ACTION_HEADERS.timestamp]: timestamp,
    [ACTION_HEADERS.nonce]: nonce,
    [ACTION_HEADERS.signature]: signPeerAction(key, { method: "POST", path: ownerPath, timestamp, nonce, body: ownerBody })
  };
  assert.equal((await fetch(`${origin}${ownerPath}`, { method: "POST", headers, body: ownerBody })).status, 202);
  const duplicate = await fetch(`${origin}${ownerPath}`, { method: "POST", headers, body: ownerBody });
  assert.equal(duplicate.status, 202);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal((await fetch(`${origin}${ownerPath}`, { method: "POST", headers: { ...headers, [ACTION_HEADERS.signature]: "0".repeat(64) }, body: ownerBody })).status, 401);
  const controlOwnerPath = "/api/node/actions/control";
  const controlOwnerBody = Buffer.from(JSON.stringify({ threadId: "thread-1", action: "interrupt", turnId: "01a04446-8d03-7243-a4d3-181180bb626e" }));
  const controlTimestamp = String(Date.now());
  const controlNonce = "nonce_2234567890123456";
  const controlHeaders = {
    "content-type": "application/json",
    [ACTION_HEADERS.timestamp]: controlTimestamp,
    [ACTION_HEADERS.nonce]: controlNonce,
    [ACTION_HEADERS.signature]: signPeerAction(key, { method: "POST", path: controlOwnerPath, timestamp: controlTimestamp, nonce: controlNonce, body: controlOwnerBody })
  };
  assert.equal((await fetch(`${origin}${controlOwnerPath}`, { method: "POST", headers: controlHeaders, body: controlOwnerBody })).status, 202);
  const settingsOwnerPath = "/api/node/actions/settings";
  const settingsOwnerBody = Buffer.from(JSON.stringify({ threadId: "01a04445-8d03-7243-a4d3-181180bb626d", changes: { reasoningEffort: "high" } }));
  const settingsTimestamp = String(Date.now());
  const settingsNonce = "nonce_3234567890123456";
  const settingsHeaders = {
    "content-type": "application/json",
    [ACTION_HEADERS.timestamp]: settingsTimestamp,
    [ACTION_HEADERS.nonce]: settingsNonce,
    [ACTION_HEADERS.signature]: signPeerAction(key, { method: "POST", path: settingsOwnerPath, timestamp: settingsTimestamp, nonce: settingsNonce, body: settingsOwnerBody })
  };
  assert.equal((await fetch(`${origin}${settingsOwnerPath}`, { method: "POST", headers: settingsHeaders, body: settingsOwnerBody })).status, 202);
  assert.deepEqual(calls, [
    ["route", "thread-1", "forest-mac", "continue remotely", undefined],
    ["control-route", "thread-1", "forest-mac", "interrupt", "01a04446-8d03-7243-a4d3-181180bb626e"],
    ["control-route", "thread-1", "forest-mac", "resolveApproval", "01a04446-8d03-7243-a4d3-181180bb626e"],
    ["settings-route", "thread-1", "forest-mac", { reasoningEffort: "high" }],
    ["owner", "thread-1", "owner executes"],
    ["control-owner", "thread-1", "01a04446-8d03-7243-a4d3-181180bb626e", "interrupt"],
    ["settings-owner", "01a04445-8d03-7243-a4d3-181180bb626d", { reasoningEffort: "high" }]
  ]);
});
