import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { normalizePeerDefinition, normalizePeerSnapshot, projectLocalNodeSnapshot } from "../src/peer-contract.mjs";
import { loadPeerConfig } from "../src/peer-config.mjs";
import { FederatedTaskAdapter } from "../src/federated-task-adapter.mjs";
import { SshPeerAdapter, sshActionArguments, sshActivityArguments, sshSnapshotArguments } from "../src/ssh-peer-adapter.mjs";

const peer = normalizePeerDefinition({
  id: "forest-mac", name: "MacBook Pro", location: "192.168.1.30",
  transports: [
    { type: "direct-ssh", host: "192.168.1.30", user: "matrix", port: 22, dashboardPort: 47831 },
    { type: "ssh-relay", relayHost: "67.230.169.158", relayUser: "root", relayPort: 33699, forwardedPort: 47842 }
  ]
});

function snapshot(id = "remote-one") {
  return {
    schemaVersion: 1,
    status: "connected",
    node: { id: "spoofed", name: "Spoofed" },
    tasks: [{ id, title: "Remote task", status: "active", cwd: "/work/remote", project: "remote", boardStatus: "active", sourceFile: "/secret/session.jsonl" }]
  };
}

test("peer definitions validate ordered direct and relay transports", () => {
  assert.deepEqual(peer.transports.map((item) => item.type), ["direct-ssh", "ssh-relay"]);
  assert.throws(() => normalizePeerDefinition({ id: "bad id", transports: [{}] }), /Peer id/);
  assert.throws(() => normalizePeerDefinition({ id: "peer", transports: [{ type: "direct-ssh", host: "host;rm", user: "root" }] }), /host/);
});

test("local node snapshots drop source paths and peer identity is configuration-owned", () => {
  const local = projectLocalNodeSnapshot({
    status: "connected",
    devices: [{ id: "local", name: "Local", location: "本机" }],
    tasks: [{ ...snapshot().tasks[0], sourceFile: "/private/native.jsonl" }]
  });
  assert.equal(local.tasks[0].sourceFile, undefined);
  const remote = normalizePeerSnapshot(peer, snapshot());
  assert.equal(remote.tasks[0].device.id, "forest-mac");
  assert.equal(remote.tasks[0].device.name, "MacBook Pro");
  assert.equal(remote.tasks[0].sourceFile, undefined);
});

test("SSH transport arguments are fixed and relay requests only relay loopback", () => {
  const direct = sshSnapshotArguments(peer.transports[0]);
  const relay = sshSnapshotArguments(peer.transports[1]);
  assert.ok(direct.includes("matrix@192.168.1.30"));
  assert.ok(direct.includes("http://127.0.0.1:47831/api/node/snapshot"));
  assert.ok(relay.includes("root@67.230.169.158"));
  assert.ok(relay.includes("http://127.0.0.1:47842/api/node/snapshot"));
  assert.ok(relay.includes("StrictHostKeyChecking=yes"));
  const activity = sshActivityArguments(peer.transports[0], "thread/one");
  assert.ok(activity.includes("http://127.0.0.1:47831/api/node/activity/thread%2Fone"));
  assert.equal(activity.some((argument) => argument.includes(";")), false);
  assert.throws(() => sshActivityArguments(peer.transports[0], "thread;unsafe"), /invalid/);
});

test("federated activity routing requires the owning device even when thread ids collide", async () => {
  const calls = [];
  const localAdapter = {
    device: { id: "matrix-air" },
    async getActivity(id) { calls.push(["local", id]); return { threadId: id, entries: [] }; }
  };
  const remoteAdapter = {
    peer: { id: "forest-mac" },
    async getActivity(id) { calls.push(["remote", id]); return { threadId: id, entries: [] }; }
  };
  const federated = new FederatedTaskAdapter({ localAdapter, peerAdapters: [remoteAdapter] });
  await federated.getActivity("same-id", "forest-mac");
  await federated.getActivity("same-id", "matrix-air");
  assert.deepEqual(calls, [["remote", "same-id"], ["local", "same-id"]]);
  assert.equal(await federated.getActivity("same-id", "unknown"), null);
});

test("peer adapter prefers direct SSH and automatically falls back to relay", async () => {
  const calls = [];
  const adapter = new SshPeerAdapter({
    peer,
    logger: { warn() {} },
    async execFileImpl(command, args) {
      calls.push([command, args]);
      if (calls.length === 1) throw new Error("direct unavailable");
      return { stdout: JSON.stringify(snapshot()) };
    }
  });
  const result = await adapter.listTasks();
  assert.equal(result.status, "connected");
  assert.equal(result.transport, "ssh-relay");
  assert.equal(calls.length, 2);
});

test("peer messages send bodies over stdin and keep prompts out of SSH arguments", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-action-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 4).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    let body = "";
    child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => {
      child.stdout.end(JSON.stringify({ status: "ok", accepted: true }));
      queueMicrotask(() => child.emit("close", 0));
    });
    invocation = { command, args, body: () => body };
    return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const result = await adapter.sendMessage("thread-1", "private prompt body");
  assert.equal(result.transport, "direct-ssh");
  assert.equal(invocation.args.some((argument) => argument.includes("private prompt body")), false);
  assert.equal(JSON.parse(invocation.body()).prompt, "private prompt body");
  assert.equal(JSON.parse(invocation.body()).expectedDraftRevision, null);
  assert.ok(invocation.args.includes("--data-binary"));
  assert.equal(invocation.args.filter((argument) => argument.includes("x-codex-node-")).some((argument) => argument.includes(" ")), false);
  assert.ok(sshActionArguments(peer.transports[0], { "x-codex-node-timestamp": "1", "x-codex-node-nonce": "nonce", "x-codex-node-signature": "a".repeat(64) }).includes("http://127.0.0.1:47831/api/node/actions/message"));
});

test("federated adapter keeps local data when a peer is unavailable", async () => {
  const localTask = { id: "local-one", title: "Local", project: "local", updatedAt: "2026-08-30T10:00:00Z", device: { id: "local" } };
  const localAdapter = {
    async listTasks() { return { status: "connected", tasks: [localTask], devices: [{ id: "local", name: "Local", status: "connected" }] }; },
    async getTask(id) { return id === localTask.id ? localTask : null; }
  };
  const remoteAdapter = { async listTasks() { return { status: "error", tasks: [], devices: [{ id: "forest-mac", status: "error" }] }; } };
  const result = await new FederatedTaskAdapter({ localAdapter, peerAdapters: [remoteAdapter] }).listTasks();
  assert.equal(result.status, "connected");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.devices.length, 2);
  assert.match(result.message, /1 个远程节点/);
});

test("peer configuration requires owner-only permissions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-config-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "peers.json");
  await fs.writeFile(file, JSON.stringify({ peers: [peer] }), { mode: 0o600 });
  assert.equal((await loadPeerConfig(file))[0].id, "forest-mac");
  await fs.chmod(file, 0o644);
  await assert.rejects(() => loadPeerConfig(file), /0600/);
});
