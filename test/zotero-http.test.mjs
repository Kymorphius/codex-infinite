import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardServer } from "../src/http-server.mjs";

function config() {
  return {
    dashboardHost: "127.0.0.1",
    dashboardPort: 0,
    dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1",
    cdpPort: 9231,
    cdpOrigin: "http://127.0.0.1:9231",
    profileDirectory: "/tmp/codex-control-console-test",
    appPath: "/Applications/ChatGPT.app"
  };
}

async function start(t, options = {}) {
  const calls = [];
  const defaultLocalApi = {
    async getWriteStatus() { calls.push(["status"]); return { status: "connected", authorization: "required", writeEnabled: false, message: "需要授权。" }; },
    async authorize() { calls.push(["authorize"]); return { status: "authorized", authorization: "authorized", remembered: false, message: "已连接。", httpStatus: 200 }; },
    async forgetAuthorization() { calls.push(["forget"]); return { status: "forgot", authorization: "required", message: "已忘记。", httpStatus: 200 }; },
    async getEditableItem(key) { calls.push(["edit", key]); return { status: "connected", item: { key }, message: "已读取。", httpStatus: 200 }; },
    async createItem(body) { calls.push(["create", body]); return { status: "created", key: "NEWITEM1", message: "已创建。", httpStatus: 201 }; },
    async addNote(key, body) { calls.push(["note", key, body]); return { status: "note_created", key: "NEWNOTE1", parentItem: key, message: "已创建。", httpStatus: 201 }; },
    async createCollection(body) { calls.push(["collection", body]); return { status: "collection_created", key: "NEWCOL1", message: "已创建。", httpStatus: 201 }; },
    async updateItem(key, body) { calls.push(["update", key, body]); return { status: "updated", key, version: 2, message: "已更新。", httpStatus: 200 }; }
  };
  const zoteroLocalApi = Object.hasOwn(options, "zoteroLocalApi") ? options.zoteroLocalApi : defaultLocalApi;
  const dashboard = createDashboardServer({ config: config(), adapter: {}, zoteroAdapter: options.zoteroAdapter, zoteroLocalApi, logger: { error() {} } });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const port = dashboard.server.address().port;
  const request = async (pathname, options = {}) => fetch(`http://127.0.0.1:${port}${pathname}`, options);
  return { calls, request };
}

test("all Zotero dashboard mutations require the exact dashboard Origin", async (t) => {
  const { calls, request } = await start(t);
  const body = JSON.stringify({ name: "New collection" });
  const missing = await request("/api/zotero/collections", { method: "POST", headers: { "content-type": "application/json" }, body });
  const wrong = await request("/api/zotero/collections", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:9999" }, body });
  const exact = await request("/api/zotero/collections", { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" }, body });

  assert.equal(missing.status, 403);
  assert.equal(wrong.status, 403);
  assert.equal(exact.status, 201);
  assert.deepEqual(calls, [["collection", { name: "New collection" }]]);
});

test("Zotero write bodies are bounded and DELETE is not exposed", async (t) => {
  const { calls, request } = await start(t);
  const tooLarge = JSON.stringify({ itemType: "book", fields: { title: "x" }, creators: [], tags: [], collections: [], padding: "x".repeat(270 * 1024) });
  const oversized = await request("/api/zotero/items", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" },
    body: tooLarge
  });
  const deleted = await request("/api/zotero/items", {
    method: "DELETE",
    headers: { origin: "http://127.0.0.1:0" }
  });
  const missingBodyType = await request("/api/zotero/authorize", {
    method: "POST",
    headers: { origin: "http://127.0.0.1:0" },
    body: "{}"
  });

  assert.equal(oversized.status, 413);
  assert.equal(deleted.status, 405);
  assert.equal(missingBodyType.status, 415);
  assert.deepEqual(calls, []);
});

test("read-only status remains available without an Origin header", async (t) => {
  const { calls, request } = await start(t);
  const result = await request("/api/zotero/write-status");
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: "connected", authorization: "required", writeEnabled: false, message: "需要授权。" });
  assert.deepEqual(calls, [["status"]]);
});

test("Zotero read routes preserve adapter query mapping and unknown-route behavior", async (t) => {
  const readCalls = [];
  const zoteroAdapter = {
    async getStatus() { readCalls.push(["read-status"]); return { status: "connected", counts: { items: 2 } }; },
    async getCollections() { readCalls.push(["read-collections"]); return { status: "connected", collections: [{ key: "C1" }] }; },
    async getItems(query) { readCalls.push(["read-items", query]); return { status: "connected", items: [], total: 0 }; }
  };
  const { request } = await start(t, { zoteroAdapter });
  assert.equal((await request("/api/zotero/status")).status, 200);
  assert.equal((await request("/api/zotero/collections")).status, 200);
  assert.equal((await request("/api/zotero/items?q=paper&collection=C1&limit=25&offset=5")).status, 200);
  assert.equal((await request("/api/zotero/unknown")).status, 404);
  assert.deepEqual(readCalls, [
    ["read-status"],
    ["read-collections"],
    ["read-items", { q: "paper", collection: "C1", limit: "25", offset: "5" }]
  ]);
});

test("Zotero edit, create, and note routes preserve result status mapping", async (t) => {
  const { calls, request } = await start(t);
  const origin = "http://127.0.0.1:0";
  const jsonHeaders = { origin, "content-type": "application/json" };
  assert.equal((await request("/api/zotero/edit/ITEM1")).status, 200);
  assert.equal((await request("/api/zotero/items", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ itemType: "book" }) })).status, 201);
  assert.equal((await request("/api/zotero/items/ITEM1/notes", { method: "POST", headers: jsonHeaders, body: JSON.stringify({ note: "Hello" }) })).status, 201);
  assert.deepEqual(calls, [
    ["edit", "ITEM1"],
    ["create", { itemType: "book" }],
    ["note", "ITEM1", { note: "Hello" }]
  ]);
});

test("Zotero controls reject invalid fields and malformed keys with typed errors", async (t) => {
  const { calls, request } = await start(t);
  const headers = { origin: "http://127.0.0.1:0", "content-type": "application/json" };
  assert.equal((await request("/api/zotero/authorize", { method: "POST", headers, body: JSON.stringify({ unexpected: true }) })).status, 400);
  assert.equal((await request("/api/zotero/edit/%ZZ")).status, 400);
  assert.deepEqual(calls, []);
});

test("Zotero write status keeps a truthful offline contract without Local API", async (t) => {
  const { request } = await start(t, { zoteroLocalApi: null });
  const response = await request("/api/zotero/write-status");
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, "offline");
  assert.equal(body.writeEnabled, false);
  assert.equal("httpStatus" in body, false);
});
