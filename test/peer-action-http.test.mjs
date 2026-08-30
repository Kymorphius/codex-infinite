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
    async sendMessage(id, device, prompt, revision) { calls.push(["route", id, device, prompt, revision]); return { accepted: true, transport: "direct-ssh" }; }
  };
  const remoteMessageService = { async submit(input) { calls.push(["owner", input.threadId, input.prompt]); return { accepted: true, requestId: "request-1" }; } };
  const dashboard = createDashboardServer({ config, adapter, local: adapter, remoteMessageService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const browserBody = JSON.stringify({ prompt: "continue remotely" });
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/messages?device=forest-mac`, { method: "POST", headers: { "content-type": "application/json" }, body: browserBody })).status, 403);
  assert.equal((await fetch(`${origin}/api/tasks/thread-1/messages?device=forest-mac`, { method: "POST", headers: { origin: config.dashboardOrigin, "content-type": "application/json" }, body: browserBody })).status, 202);

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
  assert.deepEqual(calls, [["route", "thread-1", "forest-mac", "continue remotely", undefined], ["owner", "thread-1", "owner executes"]]);
});
