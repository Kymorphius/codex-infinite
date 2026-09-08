import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/http-server.mjs";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";

function config(keyPath) {
  return {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpOrigin: "http://127.0.0.1:9231",
    nodeActionKeyPath: keyPath
  };
}

test("Turbo browser and signed owner APIs keep distinct trust boundaries", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "turbo-http-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 9);
  const keyPath = path.join(directory, "node.key");
  await fs.writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  let enabled = false;
  let millionContext = false;
  const turboPolicyService = {
    snapshot() { return { enabled, millionContext, updatedAt: "2026-08-31T12:00:00Z" }; },
    async update(change) { if (Object.hasOwn(change, "enabled")) enabled = change.enabled; if (Object.hasOwn(change, "millionContext")) millionContext = change.millionContext; return this.snapshot(); }
  };
  const turboCoordinator = {
    read() { return { enabled, millionContext, updatedAt: null, nodes: [] }; },
    async update(change) { if (Object.hasOwn(change, "enabled")) enabled = change.enabled; if (Object.hasOwn(change, "millionContext")) millionContext = change.millionContext; return { enabled, millionContext, updatedAt: "now", converged: true, nodes: [{ id: "local", status: "applied", enabled, millionContext }] }; }
  };
  const dashboard = createDashboardServer({ config: config(keyPath), adapter: {}, turboCoordinator, turboPolicyService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;

  assert.equal((await (await fetch(`${origin}/api/turbo`)).json()).enabled, false);
  const denied = await fetch(`${origin}/api/turbo`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://127.0.0.1:9" }, body: JSON.stringify({ enabled: true }) });
  assert.equal(denied.status, 403);
  const changed = await fetch(`${origin}/api/turbo`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" }, body: JSON.stringify({ enabled: true }) });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).enabled, true);
  const configured = await fetch(`${origin}/api/turbo`, { method: "PUT", headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" }, body: JSON.stringify({ millionContext: true }) });
  assert.equal(configured.status, 200);
  assert.equal((await configured.json()).millionContext, true);

  const ownerPath = "/api/node/actions/turbo";
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const body = Buffer.from(JSON.stringify({ enabled: false, millionContext: false, requestId: nonce }));
  const signature = signPeerAction(key, { method: "POST", path: ownerPath, timestamp, nonce, body });
  const owner = await fetch(`${origin}${ownerPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce, [ACTION_HEADERS.signature]: signature },
    body
  });
  assert.equal(owner.status, 202);
  assert.equal((await owner.json()).enabled, false);
});
