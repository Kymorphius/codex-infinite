import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZoteroCredentialStore } from "../src/zotero-credentials.mjs";
import { ZoteroLocalApi } from "../src/zotero-local-api.mjs";

const SERVER_ID = "zotero-server-test";
const SECRET_KEY = "LOCAL-KEY-MUST-NOT-RETURN";

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-zotero-api-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new ZoteroCredentialStore({ filePath: path.join(directory, "keys.json") });
}

function response(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function queuedFetch(...responses) {
  const calls = [];
  let index = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const next = responses[index++];
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next({ url: String(url), options, calls });
    return next;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function discovery() {
  return response(200, {}, { "Zotero-Server-ID": SERVER_ID, "Zotero-API-Version": "3" });
}

function itemResponse(version = 7) {
  return response(200, {
    data: {
      key: "ITEMONE",
      itemType: "book",
      version,
      title: "A study",
      abstractNote: "",
      date: "2024",
      url: "https://example.test/item",
      DOI: "10.1234/example",
      ISBN: "9780000000000",
      publicationTitle: "Testing Review",
      creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
      tags: [{ tag: "finance", type: 0 }],
      collections: ["COLLECT1"]
    }
  });
}

test("authorization sends the exact Local API request and never returns the key", async (t) => {
  const store = await makeStore(t);
  const fetchImpl = queuedFetch(discovery(), response(200, { key: SECRET_KEY, remember: false }));
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });

  const result = await api.authorize();
  assert.equal(result.status, "authorized");
  assert.equal(result.remembered, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET_KEY));
  assert.deepEqual(await store.get(SERVER_ID), { key: SECRET_KEY, remembered: false, oneTime: true });

  const authorizeCall = fetchImpl.calls[1];
  assert.match(authorizeCall.url, /\/api\/local\/authorize$/);
  assert.equal(authorizeCall.options.method, "POST");
  assert.deepEqual(authorizeCall.options.headers, {
    "Content-Type": "application/json",
    "Zotero-Server-ID": SERVER_ID
  });
  assert.deepEqual(JSON.parse(authorizeCall.options.body), { appName: "Codex Control Console" });
  assert.equal(Object.hasOwn(authorizeCall.options.headers, "Zotero-API-Key"), false);
});

test("updates use the latest version precondition, complete-list markers, and exact write headers", async (t) => {
  const store = await makeStore(t);
  await store.remember(SERVER_ID, "remembered-key");
  const fetchImpl = queuedFetch(
    discovery(),
    itemResponse(7),
    discovery(),
    response(204, undefined, { "Last-Modified-Version": "8" })
  );
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
  const result = await api.updateItem("ITEMONE", {
    version: 7,
    fields: { title: "Updated title", DOI: "10.1234/updated" },
    creators: [{ creatorType: "author", firstName: "Grace", lastName: "Hopper" }],
    tags: [{ tag: "updated", type: 0 }],
    collections: ["COLLECT2"],
    completeLists: ["creators", "tags", "collections"]
  });

  assert.deepEqual(result, { status: "updated", key: "ITEMONE", version: 8, message: "文献已更新，当前版本 8。", httpStatus: 200 });
  const patch = fetchImpl.calls[3];
  assert.equal(patch.options.method, "PATCH");
  assert.deepEqual(patch.options.headers, {
    "Content-Type": "application/json",
    "Zotero-API-Key": "remembered-key",
    "Zotero-Server-ID": SERVER_ID,
    "If-Unmodified-Since-Version": "7"
  });
  assert.deepEqual(JSON.parse(patch.options.body), {
    title: "Updated title",
    DOI: "10.1234/updated",
    creators: [{ creatorType: "author", firstName: "Grace", lastName: "Hopper" }],
    tags: [{ tag: "updated", type: 0 }],
    collections: ["COLLECT2"]
  });
});

test("stale editor data returns a conflict without attempting a patch", async (t) => {
  const store = await makeStore(t);
  await store.remember(SERVER_ID, "remembered-key");
  const fetchImpl = queuedFetch(discovery(), itemResponse(8));
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
  const result = await api.updateItem("ITEMONE", {
    version: 7,
    fields: { title: "Should not overwrite" },
    creators: [],
    tags: [],
    collections: [],
    completeLists: ["creators", "tags", "collections"]
  });

  assert.equal(result.status, "conflict");
  assert.equal(result.httpStatus, 412);
  assert.equal(result.expectedVersion, 7);
  assert.equal(result.actualVersion, 8);
  assert.equal(fetchImpl.calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /remembered-key/);
});

test("create, note, and collection writes use random write tokens and a one-time key expires after success", async (t) => {
  const store = await makeStore(t);
  await store.keepInMemory(SERVER_ID, "one-time-key");
  const fetchImpl = queuedFetch(
    discovery(), response(201, { success: { "0": "NEWITEM1" } }),
    discovery()
  );
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
  const first = await api.createItem({ itemType: "book", fields: { title: "First" }, creators: [], tags: [], collections: [] });
  const second = await api.createItem({ itemType: "webpage", fields: { title: "Second", url: "https://example.test" }, creators: [], tags: [], collections: [] });

  assert.equal(first.status, "created");
  assert.equal(second.status, "unauthorized");
  const firstWrite = fetchImpl.calls[1];
  assert.equal(firstWrite.options.headers["Zotero-Server-ID"], SERVER_ID);
  assert.equal(firstWrite.options.headers["Zotero-API-Key"], "one-time-key");
  assert.match(firstWrite.options.headers["Zotero-Write-Token"], /^[a-f0-9]{32}$/);
  assert.equal(await store.get(SERVER_ID), null);

  const rememberedStore = await makeStore(t);
  await rememberedStore.remember(SERVER_ID, "remembered-key");
  const tokenFetch = queuedFetch(
    discovery(), response(201, { success: { "0": "NEWITEM2" } }),
    discovery(), response(201, { success: { "0": "NEWITEM3" } })
  );
  const tokenApi = new ZoteroLocalApi({ credentialStore: rememberedStore, fetchImpl: tokenFetch });
  await tokenApi.createItem({ itemType: "book", fields: { title: "Second" }, creators: [], tags: [], collections: [] });
  await tokenApi.createItem({ itemType: "webpage", fields: { title: "Third", url: "https://example.test" }, creators: [], tags: [], collections: [] });
  const firstToken = tokenFetch.calls[1].options.headers["Zotero-Write-Token"];
  const secondToken = tokenFetch.calls[3].options.headers["Zotero-Write-Token"];
  assert.match(firstToken, /^[a-f0-9]{32}$/);
  assert.match(secondToken, /^[a-f0-9]{32}$/);
  assert.notEqual(firstToken, secondToken);
});

test("Local API status codes are mapped without exposing response bodies or keys", async (t) => {
  const statuses = [
    [401, "unauthorized"],
    [403, "denied"],
    [409, "locked"],
    [412, "conflict"],
    [428, "precondition"],
    [429, "throttled"]
  ];
  for (const [status, state] of statuses) {
    const store = await makeStore(t);
    await store.remember(SERVER_ID, SECRET_KEY);
    const fetchImpl = queuedFetch(discovery(), response(status, { secret: SECRET_KEY }));
    const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
    const result = await api.createItem({ itemType: "book", fields: { title: "Test" }, creators: [], tags: [], collections: [] });
    assert.equal(result.status, state);
    assert.equal(result.httpStatus, status);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET_KEY));
    assert.doesNotMatch(JSON.stringify(result), /secret/);
  }
});

test("unknown write fields are rejected before any network request", async (t) => {
  const store = await makeStore(t);
  const fetchImpl = queuedFetch();
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
  const createResult = await api.createItem({ itemType: "book", fields: { title: "ok", arbitraryPath: "/tmp/file" }, creators: [], tags: [], collections: [] });
  const updateResult = await api.updateItem("ITEMONE", {
    version: 1,
    fields: { title: "ok" },
    creators: [],
    tags: [],
    collections: [],
    completeLists: ["creators", "tags", "collections"],
    delete: true
  });
  assert.equal(createResult.status, "invalid");
  assert.equal(updateResult.status, "invalid");
  assert.equal(fetchImpl.calls.length, 0);
});

test("child notes and collections are created with explicit non-destructive payloads", async (t) => {
  const store = await makeStore(t);
  await store.remember(SERVER_ID, "remembered-key");
  const fetchImpl = queuedFetch(
    discovery(), itemResponse(12), discovery(), response(200, { success: { "0": "NOTEKEY1" } }),
    discovery(), response(200, { success: { "0": "COLKEY1" } })
  );
  const api = new ZoteroLocalApi({ credentialStore: store, fetchImpl });
  const note = await api.addNote("ITEMONE", { title: "Reading note", note: "A note created by the local API bridge." });
  const collection = await api.createCollection({ name: "New research", parentCollection: "COLLECT1" });

  assert.equal(note.status, "note_created");
  assert.equal(note.parentKey, "ITEMONE");
  assert.equal(collection.status, "collection_created");
  const noteCall = fetchImpl.calls[3];
  assert.equal(noteCall.options.method, "POST");
  assert.equal(noteCall.options.headers["If-Unmodified-Since-Version"], undefined);
  assert.deepEqual(JSON.parse(noteCall.options.body), [{ itemType: "note", parentItem: "ITEMONE", title: "Reading note", note: "A note created by the local API bridge." }]);
  assert.match(noteCall.options.headers["Zotero-Write-Token"], /^[a-f0-9]{32}$/);
  const collectionCall = fetchImpl.calls[5];
  assert.deepEqual(JSON.parse(collectionCall.options.body), [{ name: "New research", parentCollection: "COLLECT1" }]);
  assert.match(collectionCall.options.headers["Zotero-Write-Token"], /^[a-f0-9]{32}$/);
});
