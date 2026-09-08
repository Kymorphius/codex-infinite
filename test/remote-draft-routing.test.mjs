import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { FederatedTaskAdapter } from "../src/federated-task-adapter.mjs";
import { SshPeerAdapter } from "../src/ssh-peer-adapter.mjs";

const peer = {
  id: "forest-mac", name: "Forest Mac", platform: "posix", location: "远端",
  transports: [{ type: "direct-ssh", host: "forest.local", user: "forest", port: 22, dashboardPort: 47831 }]
};

test("federated drafts route only to the owning remote device", async () => {
  const calls = [];
  const remoteAdapter = { peer: { id: "forest-mac" }, async updateDraft(id, text, revision) { calls.push([id, text, revision]); return { accepted: true, draft: null }; } };
  const federated = new FederatedTaskAdapter({ localAdapter: { device: { id: "matrix-air" } }, peerAdapters: [remoteAdapter] });
  assert.deepEqual(await federated.updateDraft("thread-1", "forest-mac", "", "a".repeat(64)), { accepted: true, draft: null });
  assert.equal(await federated.updateDraft("thread-1", "unknown", "", null), null);
  assert.deepEqual(calls, [["thread-1", "", "a".repeat(64)]]);
});

test("peer drafts use the separate signed action and accept deletion confirmation", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-draft-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 8).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let body = "";
    child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => { child.stdout.end(JSON.stringify({ status: "ok", accepted: true, draft: null })); queueMicrotask(() => child.emit("close", 0)); });
    invocation = { args, body: () => body };
    return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const result = await adapter.updateDraft("thread-1", "", "a".repeat(64));
  assert.equal(result.draft, null);
  assert.ok(invocation.args.includes("http://127.0.0.1:47831/api/node/actions/draft"));
  assert.equal(JSON.parse(invocation.body()).text, "");
});
