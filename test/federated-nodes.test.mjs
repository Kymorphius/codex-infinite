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

function nativeSnapshot(id = "remote-one") {
  return {
    ...snapshot(id),
    schemaVersion: 2,
    node: {
      runtime: {
        authority: "owner-native-desktop",
        health: "connected",
        submission: "native-composer",
        activity: "rollout-projection",
        featurePolicy: "owner-native"
      }
    }
  };
}

test("peer definitions validate ordered direct and relay transports", () => {
  assert.equal(peer.platform, "posix");
  assert.deepEqual(peer.transports.map((item) => item.type), ["direct-ssh", "ssh-relay"]);
  assert.throws(() => normalizePeerDefinition({ id: "bad id", transports: [{}] }), /Peer id/);
  assert.throws(() => normalizePeerDefinition({ id: "peer", transports: [{ type: "direct-ssh", host: "host;rm", user: "root" }] }), /host/);
  assert.throws(() => normalizePeerDefinition({ id: "peer", platform: "plan9", transports: [{ type: "direct-ssh", host: "host", user: "root" }] }), /platform/);
});

test("local node snapshots drop source paths and peer identity is configuration-owned", () => {
  const local = projectLocalNodeSnapshot({
    status: "connected",
    devices: [{ id: "local", name: "Local", location: "本机" }],
    tasks: [{ ...snapshot().tasks[0], projectId: "project-123", projectDisplayName: "远程项目", sourceFile: "/private/native.jsonl", approvalPolicy: "never", permissionProfile: ":danger-full-access", accessMode: "full-access", contextOverrideState: "extended", requestedContextWindow: 1_000_000 }]
  });
  assert.equal(local.schemaVersion, 3);
  assert.equal(local.tasks[0].sourceFile, undefined);
  assert.equal(local.tasks[0].accessMode, "full-access");
  assert.equal(local.tasks[0].contextOverrideState, "extended");
  assert.equal(local.tasks[0].project, "remote");
  assert.equal(local.tasks[0].projectId, "project-123");
  assert.equal(local.tasks[0].projectDisplayName, "远程项目");
  const remote = normalizePeerSnapshot(peer, snapshot());
  assert.equal(remote.tasks[0].device.id, "forest-mac");
  assert.equal(remote.tasks[0].device.name, "MacBook Pro");
  assert.equal(remote.tasks[0].sourceFile, undefined);
  assert.equal(remote.devices[0].runtime.authority, "unknown");
  const native = normalizePeerSnapshot(peer, nativeSnapshot());
  assert.equal(native.devices[0].runtime.authority, "owner-native-desktop");
  assert.equal(native.tasks[0].device.runtime.featurePolicy, "owner-native");
  assert.equal(native.tasks[0].accessMode, "unknown");
  assert.equal(native.tasks[0].contextOverrideState, "unknown");
  const current = normalizePeerSnapshot(peer, local);
  assert.equal(current.devices[0].runtime.authority, "unknown");
  assert.equal(current.tasks[0].permissionProfile, ":danger-full-access");
  assert.equal(current.tasks[0].projectId, "project-123");
  assert.throws(() => normalizePeerSnapshot(peer, { ...local, tasks: [{ ...local.tasks[0], accessMode: "root" }] }), /settings are invalid/);
});

test("SSH transport arguments are fixed and relay requests only relay loopback", () => {
  const direct = sshSnapshotArguments(peer.transports[0]);
  const relay = sshSnapshotArguments(peer.transports[1]);
  assert.ok(direct.includes("matrix@192.168.1.30"));
  assert.ok(direct.includes("http://127.0.0.1:47831/api/node/snapshot"));
  assert.ok(relay.includes("root@67.230.169.158"));
  assert.ok(relay.includes("http://127.0.0.1:47842/api/node/snapshot"));
  assert.ok(relay.includes("StrictHostKeyChecking=yes"));
  assert.equal(direct[direct.indexOf("--max-time") + 1], "25");
  const activity = sshActivityArguments(peer.transports[0], "thread/one");
  assert.equal(activity[activity.indexOf("--max-time") + 1], "12");
  assert.ok(activity.includes("http://127.0.0.1:47831/api/node/activity/thread%2Fone"));
  assert.equal(activity.some((argument) => argument.includes(";")), false);
  assert.throws(() => sshActivityArguments(peer.transports[0], "thread;unsafe"), /invalid/);
  const action = sshActionArguments(peer.transports[0], {
    "x-codex-node-timestamp": "1",
    "x-codex-node-nonce": "nonce",
    "x-codex-node-signature": "a".repeat(64)
  });
  assert.equal(action[action.indexOf("--max-time") + 1], "10");
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

test("federated control routing requires the owning remote device", async () => {
  const calls = [];
  const remoteAdapter = { peer: { id: "forest-mac" }, async control(id, input) { calls.push([id, input]); return { accepted: true }; } };
  const federated = new FederatedTaskAdapter({ localAdapter: { device: { id: "matrix-air" } }, peerAdapters: [remoteAdapter] });
  assert.deepEqual(await federated.control("thread-1", "forest-mac", { action: "interrupt", turnId: "turn-1" }), { accepted: true });
  assert.equal(await federated.control("thread-1", "unknown", { action: "interrupt", turnId: "turn-1" }), null);
  assert.deepEqual(calls, [["thread-1", { action: "interrupt", turnId: "turn-1" }]]);
});

test("federated settings route only to the owning remote device", async () => {
  const calls = [];
  const remoteAdapter = { peer: { id: "forest-mac" }, async updateSettings(id, changes) { calls.push([id, changes]); return { accepted: true }; } };
  const federated = new FederatedTaskAdapter({ localAdapter: { device: { id: "matrix-air" } }, peerAdapters: [remoteAdapter] });
  assert.deepEqual(await federated.updateSettings("thread-1", "forest-mac", { reasoningEffort: "high" }), { accepted: true });
  assert.equal(await federated.updateSettings("thread-1", "unknown", { reasoningEffort: "high" }), null);
  assert.deepEqual(calls, [["thread-1", { reasoningEffort: "high" }]]);
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
      child.stdout.end(JSON.stringify({ status: "ok", accepted: true, executionAuthority: "owner-native-desktop" }));
      queueMicrotask(() => child.emit("close", 0));
    });
    invocation = { command, args, body: () => body };
    return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const result = await adapter.sendMessage("thread-1", "private prompt body");
  assert.equal(result.transport, "direct-ssh");
  assert.equal(result.executionAuthority, "owner-native-desktop");
  assert.equal(invocation.args.some((argument) => argument.includes("private prompt body")), false);
  assert.equal(JSON.parse(invocation.body()).prompt, "private prompt body");
  assert.equal(JSON.parse(invocation.body()).expectedDraftRevision, null);
  assert.equal(JSON.parse(invocation.body()).deliveryMode, "new-turn");
  assert.ok(invocation.args.includes("--data-binary"));
  assert.equal(invocation.args.filter((argument) => argument.includes("x-codex-node-")).some((argument) => argument.includes(" ")), false);
  assert.ok(sshActionArguments(peer.transports[0], { "x-codex-node-timestamp": "1", "x-codex-node-nonce": "nonce", "x-codex-node-signature": "a".repeat(64) }).includes("http://127.0.0.1:47831/api/node/actions/message"));
});

test("peer interruption uses the separate signed control path and stdin body", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-control-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 6).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let body = "";
    child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => { child.stdout.end(JSON.stringify({ status: "ok", accepted: true, interrupted: true })); queueMicrotask(() => child.emit("close", 0)); });
    invocation = { command, args, body: () => body };
    return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const result = await adapter.control("thread-1", { action: "interrupt", turnId: "turn-1" });
  assert.equal(result.interrupted, true);
  assert.ok(invocation.args.includes("http://127.0.0.1:47831/api/node/actions/control"));
  assert.deepEqual({ ...JSON.parse(invocation.body()), requestId: "bounded" }, { threadId: "thread-1", action: "interrupt", turnId: "turn-1", requestId: "bounded" });
});

test("peer approval resolution uses the signed control path without exposing it in SSH arguments", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-approval-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 7).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (command, args) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let body = "";
    child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => { child.stdout.end(JSON.stringify({ status: "ok", accepted: true, approvalResolved: true, decision: "accept" })); queueMicrotask(() => child.emit("close", 0)); });
    invocation = { args, body: () => body };
    return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const input = {
    action: "resolveApproval",
    turnId: "01a04446-8d03-7243-a4d3-181180bb626e",
    approvalToken: "01a04447-8d03-7243-a4d3-181180bb626f",
    decision: "accept"
  };
  const result = await adapter.control("01a04445-8d03-7243-a4d3-181180bb626d", input);
  assert.equal(result.approvalResolved, true);
  assert.equal(result.decision, "accept");
  assert.ok(invocation.args.includes("http://127.0.0.1:47831/api/node/actions/control"));
  assert.equal(invocation.args.some((argument) => argument.includes(input.approvalToken)), false);
  assert.deepEqual({ ...JSON.parse(invocation.body()), requestId: "bounded" }, {
    threadId: "01a04445-8d03-7243-a4d3-181180bb626d",
    ...input,
    requestId: "bounded"
  });
});

test("peer settings use their signed path and validate owner confirmation", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 8).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (_command, args) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let body = ""; child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => {
      child.stdout.end(JSON.stringify({ status: "ok", accepted: true, effectiveFrom: "next-turn", ownerSurface: "primary-native", ownerBridge: "writer-matched", settings: { model: "gpt-5.6-sol", reasoningEffort: "high", approvalPolicy: "never", permissionProfile: ":danger-full-access", accessMode: "full-access", contextOverrideState: "default", requestedContextWindow: null, modelContextWindow: 258400 }, settingsOptions: { models: [{ id: "gpt-5.6-sol", displayName: "Sol", description: null, defaultReasoningEffort: "high", reasoningEfforts: [{ effort: "high", description: null }] }], accessModes: ["read-only", "workspace", "full-access"], contextWindow: 1000000 } }));
      queueMicrotask(() => child.emit("close", 0));
    });
    invocation = { args, body: () => body }; return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const id = "01a04445-8d03-7243-a4d3-181180bb626d";
  const result = await adapter.updateSettings(id, { reasoningEffort: "high" });
  assert.equal(result.settings.reasoningEffort, "high");
  assert.equal(result.settingsOptions.contextWindow, 1_000_000);
  assert.equal(result.ownerSurface, "primary-native");
  assert.equal(result.ownerBridge, "writer-matched");
  assert.ok(invocation.args.includes("http://127.0.0.1:47831/api/node/actions/settings"));
  assert.deepEqual({ ...JSON.parse(invocation.body()), requestId: "bounded" }, { threadId: id, changes: { reasoningEffort: "high" }, requestId: "bounded" });
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
  if (process.platform === "win32") assert.equal((await loadPeerConfig(file))[0].id, "forest-mac");
  else await assert.rejects(() => loadPeerConfig(file), /0600/);
});
