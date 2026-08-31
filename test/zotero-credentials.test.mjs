import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZoteroCredentialStore } from "../src/zotero-credentials.mjs";

async function makeStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-zotero-credentials-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, store: new ZoteroCredentialStore({ filePath: path.join(directory, "state", "keys.json") }) };
}

test("remembered Zotero keys are partitioned by server id and written with mode 0600", async (t) => {
  const { store } = await makeStore(t);
  await store.remember("server-one", "key-one");

  assert.deepEqual(await store.get("server-one"), { key: "key-one", remembered: true, oneTime: false });
  assert.equal(await store.get("server-two"), null);

  const stats = await fs.stat(store.filePath);
  assert.equal(stats.mode & 0o777, 0o600);
  const document = JSON.parse(await fs.readFile(store.filePath, "utf8"));
  assert.equal(document.version, 1);
  assert.equal(document.keys["server-one"].key, "key-one");
  assert.equal(document.keys["server-two"], undefined);
});

test("one-time authorization stays in memory, wins over an older partition, and is consumed once", async (t) => {
  const { store } = await makeStore(t);
  await store.remember("server-one", "old-key");
  await store.keepInMemory("server-one", "one-time-key");

  assert.deepEqual(await store.get("server-one"), { key: "one-time-key", remembered: false, oneTime: true });
  assert.equal(await store.consumeOneTime("server-one"), true);
  assert.equal(await store.consumeOneTime("server-one"), false);
  assert.equal(await store.get("server-one"), null);
  assert.equal(await fs.stat(store.filePath).then(() => true, () => false), true);
  const document = JSON.parse(await fs.readFile(store.filePath, "utf8"));
  assert.equal(document.keys["server-one"], undefined);
});

test("forget removes only the selected server partition", async (t) => {
  const { store } = await makeStore(t);
  await store.remember("server-one", "key-one");
  await store.remember("server-two", "key-two");
  assert.equal(await store.forget("server-one"), true);
  assert.equal(await store.get("server-one"), null);
  assert.deepEqual(await store.get("server-two"), { key: "key-two", remembered: true, oneTime: false });
});
