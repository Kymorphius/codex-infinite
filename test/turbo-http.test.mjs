import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/http-server.mjs";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";
import { TurboCoordinator } from "../src/turbo-control.mjs";

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
  let autoDisableGlobalRouting = false;
  let quotaSettings = { autoDisableOnLowQuota: true, quotaRemainingThreshold: 10 };
  const routingChanges = [];
  const turboPolicyService = {
    snapshot() { return { enabled, millionContext, autoDisableGlobalRouting, ...quotaSettings, updatedAt: "2026-08-31T12:00:00Z" }; },
    async update(change) { if (Object.hasOwn(change, "enabled")) enabled = change.enabled; if (Object.hasOwn(change, "millionContext")) millionContext = change.millionContext; if (Object.hasOwn(change, "autoDisableGlobalRouting")) autoDisableGlobalRouting = change.autoDisableGlobalRouting; quotaSettings = { ...quotaSettings, ...Object.fromEntries(["autoDisableOnLowQuota", "quotaRemainingThreshold"].filter(key => Object.hasOwn(change, key)).map(key => [key, change[key]])) }; return this.snapshot(); }
  };
  const jevRoutingService = { async setEnabled(value) { routingChanges.push(value); } };
  const turboCoordinator = new TurboCoordinator({ localService: turboPolicyService, routingService: jevRoutingService });
  const dashboard = createDashboardServer({ config: config(keyPath), adapter: {}, turboCoordinator, turboPolicyService, jevRoutingService });
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
  const body = Buffer.from(JSON.stringify({ enabled: true, millionContext: false, autoDisableGlobalRouting: true, autoDisableOnLowQuota: false, quotaRemainingThreshold: 25, requestId: nonce }));
  const signature = signPeerAction(key, { method: "POST", path: ownerPath, timestamp, nonce, body });
  const owner = await fetch(`${origin}${ownerPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce, [ACTION_HEADERS.signature]: signature },
    body
  });
  assert.equal(owner.status, 202);
  const ownerPolicy = await owner.json();
  assert.equal(ownerPolicy.enabled, true);
  assert.equal(ownerPolicy.autoDisableGlobalRouting, true);
  assert.equal(ownerPolicy.autoDisableOnLowQuota, false);
  assert.equal(ownerPolicy.quotaRemainingThreshold, 25);
  assert.deepEqual(routingChanges, [false]);
});

test("browser save and sync use exact-origin policy-only routes and distinct scopes", async (t) => {
  let policy = { enabled: true, model: "gpt-5.6-luna", reasoningEffort: "high", fast: false,
    millionContext: true, autoDisableGlobalRouting: false, autoDisableOnLowQuota: true, quotaRemainingThreshold: 10, accessMode: "workspace", deviceIds: ["local"] };
  const saved = [], remote = [];
  const turboPolicyService = { snapshot: () => policy,
    async update(change) { saved.push(change); policy = { ...policy, ...change }; return policy; } };
  const turboCoordinator = new TurboCoordinator({ localService: turboPolicyService, peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { remote.push(change); return change; } }
  ] });
  const dashboard = createDashboardServer({ config: config(), adapter: {}, turboCoordinator, turboPolicyService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  const put = (route, value, source = "http://127.0.0.1:0") => fetch(`${origin}/api/turbo/${route}`, {
    method: "PUT", headers: { "content-type": "application/json", origin: source }, body: JSON.stringify(value)
  });
  for (const route of ["save", "sync"]) {
    assert.equal((await put(route, { fast: true }, "http://127.0.0.1:9")).status, 403);
    assert.equal((await put(route, { fast: true, operation: route })).status, 400);
    assert.equal((await put(route, { fast: true, requestId: "request-id-12345678" })).status, 400);
    assert.equal((await put(route, {})).status, 400);
    assert.equal((await put(route, [])).status, 400);
    for (const change of [{ autoDisableOnLowQuota: "true" }, ...[-1, 101, 10.5, "10", null].map(quotaRemainingThreshold => ({ quotaRemainingThreshold }))]) {
      assert.equal((await put(route, change)).status, 400);
    }
    assert.equal((await fetch(`${origin}/api/turbo/${route}`)).status, 405);
  }
  assert.equal(saved.length, 0);
  assert.equal(remote.length, 0);
  const local = await put("save", { fast: true, autoDisableOnLowQuota: false, quotaRemainingThreshold: 0 });
  assert.equal(local.status, 200);
  assert.equal((await local.json()).operation, "save");
  assert.deepEqual(saved, [{ fast: true, autoDisableOnLowQuota: false, quotaRemainingThreshold: 0 }]);
  assert.equal(remote.length, 0);
  const synchronized = await put("sync", { fast: false, autoDisableOnLowQuota: true, quotaRemainingThreshold: 100 });
  assert.equal(synchronized.status, 200);
  assert.equal((await synchronized.json()).operation, "sync");
  assert.deepEqual(remote, [policy]);
  assert.equal(remote[0].autoDisableOnLowQuota, true);
  assert.equal(remote[0].quotaRemainingThreshold, 100);
  assert.deepEqual(policy.deviceIds, ["local"]);
});

test("browser sync keeps partial device results visible with a 207 response", async (t) => {
  const result = { operation: "sync", converged: false, nodes: [
    { id: "local", status: "applied" }, { id: "peer", status: "mismatch", mismatchedFields: ["fast"] }
  ] };
  const dashboard = createDashboardServer({ config: config(), adapter: {}, turboCoordinator: { async sync() { return result; } } });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const response = await fetch(`http://127.0.0.1:${dashboard.server.address().port}/api/turbo/sync`, {
    method: "PUT", headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" }, body: JSON.stringify({ fast: true })
  });
  assert.equal(response.status, 207);
  assert.deepEqual(await response.json(), { status: "ok", ...result });
});

test("signed owner writes reject a busy coordinator and remain local when accepted", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "turbo-http-busy-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 14), keyPath = path.join(directory, "node.key");
  await fs.writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  let policy = { enabled: true, fast: false, autoDisableGlobalRouting: false };
  const turboPolicyService = { snapshot: () => policy, async update(change) { policy = { ...policy, ...change }; return policy; } };
  let releasePeer, signalPeer, peerCalls = 0;
  const entered = new Promise((resolve) => { signalPeer = resolve; });
  const held = new Promise((resolve) => { releasePeer = resolve; });
  const turboCoordinator = new TurboCoordinator({ localService: turboPolicyService, peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { peerCalls += 1; signalPeer(); await held; return change; } }
  ] });
  const dashboard = createDashboardServer({ config: config(keyPath), adapter: {}, turboCoordinator, turboPolicyService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const url = `http://127.0.0.1:${dashboard.server.address().port}/api/node/actions/turbo`;
  const signedRequest = (change) => {
    const timestamp = String(Date.now()), nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify({ ...change, requestId: nonce }));
    const signature = signPeerAction(key, { method: "POST", path: "/api/node/actions/turbo", timestamp, nonce, body });
    return { method: "POST", headers: { "content-type": "application/json", [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: nonce, [ACTION_HEADERS.signature]: signature }, body };
  };
  const outgoing = turboCoordinator.sync({ fast: true });
  await entered;
  const unauthenticated = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fast: false }) });
  assert.equal(unauthenticated.status, 401);
  const busy = await fetch(url, signedRequest({ fast: false }));
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).code, "TURBO_PEER_BUSY");
  assert.equal(policy.fast, true);
  releasePeer();
  assert.equal((await outgoing).converged, true);
  for (const change of [{ autoDisableOnLowQuota: "true" }, { quotaRemainingThreshold: -1 }, { quotaRemainingThreshold: 101 }, { quotaRemainingThreshold: 10.5 }]) {
    assert.equal((await fetch(url, signedRequest(change))).status, 400);
  }
  const request = signedRequest({ fast: false, autoDisableOnLowQuota: false, quotaRemainingThreshold: 30 });
  const accepted = await fetch(url, request);
  assert.equal(accepted.status, 202);
  const response = await accepted.json();
  assert.equal(response.fast, false);
  assert.equal(response.autoDisableOnLowQuota, false);
  assert.equal(response.quotaRemainingThreshold, 30);
  assert.equal(Object.hasOwn(response, "operation"), false);
  assert.equal(Object.hasOwn(response, "nodes"), false);
  assert.equal(peerCalls, 1);
  const duplicate = await fetch(url, request);
  assert.equal(duplicate.status, 202);
  const duplicatePolicy = await duplicate.json();
  assert.equal(duplicatePolicy.duplicate, true);
  assert.equal(duplicatePolicy.autoDisableOnLowQuota, false);
  assert.equal(duplicatePolicy.quotaRemainingThreshold, 30);
  assert.equal(peerCalls, 1);
});
