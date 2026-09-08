import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { normalizePeerDefinition } from "../src/peer-contract.mjs";
import { SshPeerAdapter } from "../src/ssh-peer-adapter.mjs";

const peer = normalizePeerDefinition({
  id: "forest-mac", name: "MacBook Pro", location: "192.168.1.30",
  transports: [{ type: "direct-ssh", host: "192.168.1.30", user: "matrix", port: 22, dashboardPort: 47831 }]
});

function respondingSpawn(payload) {
  return () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    child.stdin.on("finish", () => {
      child.stdout.end(JSON.stringify(payload));
      queueMicrotask(() => child.emit("close", 0));
    });
    return child;
  };
}

async function adapterFor(t, payload) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-skills-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 11).toString("base64"), { mode: 0o600 });
  return new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl: respondingSpawn(payload), logger: { warn() {} } });
}

test("peer Skill toggle accepts the explicit owner confirmation", async (t) => {
  const adapter = await adapterFor(t, { status: "ok", accepted: true, enabled: false, restartRequired: true });
  assert.deepEqual(await adapter.toggleSkill({ scope: "codex-user", sourceId: "codex-user", name: "demo", enabled: false }), {
    enabled: false, restartRequired: true, transport: "direct-ssh"
  });
});

test("peer Skill toggle remains compatible with an authenticated legacy owner response", async (t) => {
  const adapter = await adapterFor(t, { status: "ok", enabled: true, restartRequired: true });
  assert.equal((await adapter.toggleSkill({ scope: "codex-user", sourceId: "codex-user", name: "demo", enabled: true })).enabled, true);
});

test("peer Skill toggle rejects a negative or incomplete owner response", async (t) => {
  const rejected = await adapterFor(t, { status: "ok", accepted: false, enabled: false });
  await assert.rejects(rejected.toggleSkill({ scope: "codex-user", sourceId: "codex-user", name: "demo", enabled: false }), /所属节点拒绝/);
  const incomplete = await adapterFor(t, { status: "ok", accepted: true });
  await assert.rejects(incomplete.toggleSkill({ scope: "codex-user", sourceId: "codex-user", name: "demo", enabled: false }), /所属节点拒绝/);
});
