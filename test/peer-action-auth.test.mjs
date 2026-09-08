import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ACTION_HEADERS, loadActionKey, NonceReplayWindow, signPeerAction, verifyPeerAction } from "../src/peer-action-auth.mjs";

test("owner action keys require 32-byte material and owner-only permissions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-action-key-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "node-action.key");
  await fs.writeFile(file, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  assert.equal((await loadActionKey(file)).length, 32);
  await fs.chmod(file, 0o644);
  if (process.platform === "win32") assert.equal((await loadActionKey(file)).length, 32);
  else await assert.rejects(() => loadActionKey(file), /0600/);
});

test("signed owner actions detect body changes, stale timestamps, and nonce replay", () => {
  const key = Buffer.alloc(32, 9);
  const now = 1_800_000_000_000;
  const timestamp = String(now);
  const nonce = "nonce_1234567890123456";
  const body = Buffer.from('{"threadId":"one","prompt":"hello"}');
  const path = "/api/node/actions/message";
  const signature = signPeerAction(key, { method: "POST", path, timestamp, nonce, body });
  const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce, [ACTION_HEADERS.signature]: signature };
  const replayWindow = new NonceReplayWindow({ now: () => now });
  assert.deepEqual(verifyPeerAction({ key, method: "POST", path, headers, body, replayWindow, now }), { ok: true, duplicate: false });
  assert.deepEqual(verifyPeerAction({ key, method: "POST", path, headers, body, replayWindow, now }), { ok: true, duplicate: true });
  assert.equal(verifyPeerAction({ key, method: "POST", path, headers, body: Buffer.from("changed"), replayWindow: new NonceReplayWindow(), now }).ok, false);
  assert.equal(verifyPeerAction({ key, method: "POST", path, headers: { ...headers, [ACTION_HEADERS.timestamp]: String(now - 31_000) }, body, replayWindow: new NonceReplayWindow(), now }).reason, "stale");
});
