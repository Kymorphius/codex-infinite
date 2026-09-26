import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";
import { createProjectSyncHttpHandler } from "../src/project-sync-http.mjs";
import { PROJECT_SYNC_PACKAGE_BYTES } from "../src/project-sync-peer-commands.mjs";

const origin = "http://127.0.0.1:47831";

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "project-sync-http-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const keyPath = path.join(root, "key");
  await fs.writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  const calls = [];
  const service = {
    catalog: async () => ({ devices: [{ id: "local", projects: [] }] }),
    preflight: async (input) => { calls.push(["preflight", input]); return { token: "short-lived", source: { head: "a" } }; },
    execute: async (input) => { calls.push(["execute", input]); return { verified: true }; }
  };
  const localAdapter = Object.fromEntries(["catalog", "inspect", "export", "prepare", "apply"].map((action) => [action, async (input) => {
    calls.push([action, input]);
    return action === "export" ? { bundleBase64: "private-bundle" } : { action, input };
  }]));
  const handler = createProjectSyncHttpHandler({ dashboardOrigin: origin, nodeActionKeyPath: keyPath, service, localAdapter, ...overrides });
  function signed(url, body = "{}", extra = {}) {
    const timestamp = String(Date.now());
    const nonce = crypto.randomUUID();
    return {
      "content-type": "application/json",
      [ACTION_HEADERS.timestamp]: timestamp,
      [ACTION_HEADERS.nonce]: nonce,
      [ACTION_HEADERS.signature]: signPeerAction(key, { method: "POST", path: url, timestamp, nonce, body: Buffer.from(body) }),
      ...extra
    };
  }
  async function request(url, { method = "POST", headers = {}, body = "{}" } = {}) {
    const request = Readable.from([Buffer.from(body)]);
    Object.assign(request, { method, headers });
    let result;
    const response = {
      writeHead(status, headers) { result = { status, headers }; },
      end(body) { result.body = JSON.parse(body); }
    };
    try {
      const handled = await handler(request, response, new URL(url, origin));
      return handled ? result : { status: 404 };
    } catch (error) { return { status: error.statusCode || 500, body: { message: error.message } }; }
  }
  return { calls, request, signed };
}

test("browser catalog and exact-origin actions expose summaries without node bundle endpoints", async (t) => {
  const { calls, request } = await fixture(t);
  const catalog = await request("/api/project-sync/catalog", { method: "GET" });
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body.devices, [{ id: "local", projects: [] }]);
  const input = { source: { path: "/源", deviceId: "local" }, target: { path: "/target", deviceId: "remote" } };
  const preflight = await request("/api/project-sync/preflight", { headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(preflight.body.token, "short-lived");
  assert.equal(JSON.stringify(preflight.body).includes("private-bundle"), false);
  assert.deepEqual(calls, [["preflight", input]]);
  assert.equal((await request("/api/project-sync/export", { method: "GET" })).status, 404);
  assert.equal((await request("/api/node/project-sync/export", { method: "GET" })).status, 405);
});

test("browser mutations reject missing and cross origins, non-json and oversized requests", async (t) => {
  const { calls, request } = await fixture(t);
  const url = "/api/project-sync/execute";
  for (const invalidOrigin of [undefined, "http://localhost:47831", "https://evil.test", "null"]) {
    assert.equal((await request(url, { headers: { origin: invalidOrigin, "content-type": "application/json" } })).status, 403);
  }
  assert.equal((await request(url, { headers: { origin, "content-type": "text/plain" } })).status, 415);
  assert.equal((await request(url, { headers: { origin, "content-type": "application/json-evil" } })).status, 415);
  assert.equal((await request(url, { headers: { origin, "content-type": "application/json" }, body: " ".repeat(8193) })).status, 413);
  assert.equal((await request(url, { headers: { origin, "content-type": "application/json" }, body: "[]" })).status, 400);
  assert.deepEqual(calls, []);
});

test("every node action requires signed JSON and rejects browser-origin requests", async (t) => {
  const { calls, request, signed } = await fixture(t);
  for (const action of ["catalog", "inspect", "export", "prepare", "apply"]) {
    const url = `/api/node/project-sync/${action}`;
    const body = JSON.stringify({ path: "/项目", expectedHead: "abc" });
    assert.equal((await request(url, { headers: { "content-type": "application/json" }, body })).status, 401);
    assert.equal((await request(url, { headers: signed(url, body, { origin }), body })).status, 403);
    assert.equal((await request(url, { headers: signed(url, body, { "sec-fetch-mode": "cors" }), body })).status, 403);
    assert.equal((await request(url, { headers: signed(url, body, { "content-type": "text/plain" }), body })).status, 415);
    const accepted = await request(url, { headers: signed(url, body), body });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.status, "ok");
  }
  assert.deepEqual(calls.map(([action]) => action), ["catalog", "inspect", "export", "prepare", "apply"]);
  assert.deepEqual(calls[1][1], { path: "/项目", expectedHead: "abc" });
});

test("signatures bind request path and body; all replays reject without dispatch", async (t) => {
  const { calls, request, signed } = await fixture(t);
  for (const action of ["catalog", "inspect", "export", "prepare", "apply"]) {
    const url = `/api/node/project-sync/${action}`;
    const headers = signed(url);
    assert.equal((await request(url, { headers, body: '{"tampered":true}' })).status, 401);
    const other = action === "catalog" ? "inspect" : "catalog";
    assert.equal((await request(`/api/node/project-sync/${other}`, { headers })).status, 401);
    assert.equal((await request(url, { headers })).status, 200);
    assert.equal((await request(url, { headers })).status, 409);
  }
  assert.equal(calls.length, 5);
});

test("prepare allows a package body, other node requests remain small and packages stay bounded", async (t) => {
  const { calls, request, signed } = await fixture(t);
  const body = JSON.stringify({ bundleBase64: "a".repeat(9000) });
  const prepare = "/api/node/project-sync/prepare";
  assert.equal((await request(prepare, { body, headers: signed(prepare, body) })).status, 200);
  const inspect = "/api/node/project-sync/inspect";
  assert.equal((await request(inspect, { body, headers: signed(inspect, body) })).status, 413);
  const excessive = " ".repeat(PROJECT_SYNC_PACKAGE_BYTES + 1);
  assert.equal((await request(prepare, { body: excessive, headers: signed(prepare, excessive) })).status, 413);
  assert.equal(calls.length, 1);
});

test("node export response permits the bounded base64 package and rejects excessive output", async (t) => {
  let bundleBase64 = "a".repeat(32 * 1024 * 1024);
  const { request, signed } = await fixture(t, { localAdapter: { export: async () => ({ bundleBase64 }) } });
  const url = "/api/node/project-sync/export";
  assert.equal((await request(url, { headers: signed(url) })).status, 200);
  bundleBase64 = "a".repeat(PROJECT_SYNC_PACKAGE_BYTES);
  assert.equal((await request(url, { headers: signed(url) })).status, 502);
});
