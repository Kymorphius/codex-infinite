import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { normalizePeerDefinition } from "../src/peer-contract.mjs";
import { SshPeerAdapter } from "../src/ssh-peer-adapter.mjs";
import { ACTION_HEADERS, NonceReplayWindow, verifyPeerAction } from "../src/peer-action-auth.mjs";

const peer = normalizePeerDefinition({
  id: "forest-mac", name: "MacBook Pro", location: "192.168.1.30",
  transports: [{ type: "direct-ssh", host: "192.168.1.30", user: "dev", port: 22, dashboardPort: 47831 }]
});

test("peer Turbo switch uses the signed owner path and bounded boolean contract", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-turbo-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "forest-mac.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 10).toString("base64"), { mode: 0o600 });
  let invocation;
  const spawnImpl = (_command, args) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    let body = ""; child.stdin.on("data", (chunk) => { body += chunk.toString(); });
    child.stdin.on("finish", () => { child.stdout.end(JSON.stringify({ status: "ok", accepted: true, enabled: true, model: "gpt-5.6-luna", reasoningEffort: "max", fast: false, millionContext: true, autoDisableGlobalRouting: true, accessMode: "workspace", deviceIds: ["forest-mac"] })); queueMicrotask(() => child.emit("close", 0)); });
    invocation = { args, body: () => body }; return child;
  };
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
  const result = await adapter.updateTurbo({ enabled: true, model: "gpt-5.6-luna", reasoningEffort: "max", fast: false, millionContext: true, autoDisableGlobalRouting: true, accessMode: "workspace", deviceIds: ["forest-mac"] });
  assert.equal(result.enabled, true);
  assert.equal(result.millionContext, true);
  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(result.fast, false);
  assert.equal(result.autoDisableGlobalRouting, true);
  assert.deepEqual(result.deviceIds, ["forest-mac"]);
  assert.ok(invocation.args.includes("http://127.0.0.1:47831/api/node/actions/turbo"));
  assert.equal(JSON.parse(invocation.body()).enabled, true);
  assert.equal(JSON.parse(invocation.body()).millionContext, true);
  assert.equal(JSON.parse(invocation.body()).autoDisableGlobalRouting, true);
  assert.equal(JSON.parse(invocation.body()).accessMode, "workspace");
  const headers = Object.fromEntries(Object.values(ACTION_HEADERS).map((name) => [name, invocation.args.find((arg) => arg.startsWith(`${name}:`)).slice(name.length + 1)]));
  assert.equal(verifyPeerAction({ key: Buffer.alloc(32, 10), method: "POST", path: "/api/node/actions/turbo", headers, body: Buffer.from(invocation.body()), replayWindow: new NonceReplayWindow() }).ok, true);
});

test("peer Turbo rejects action metadata and malformed policy before transport", async () => {
  const adapter = new SshPeerAdapter({ peer, actionKeyPath: "/never-read", spawnImpl() { assert.fail("invalid policy must not reach transport"); } });
  for (const change of [{ autoDisableGlobalRouting: "yes" }, { model: 42 }, { deviceIds: [42] }, { enabled: true, operation: "sync" }, { enabled: true, requestId: "valid-request-id" }]) {
    await assert.rejects(adapter.updateTurbo(change), { statusCode: 400 });
  }
});

test("peer Turbo distinguishes owner rejection, incomplete confirmation, and transport failure", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-peer-turbo-errors-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const keyPath = path.join(directory, "peer.key");
  await fs.writeFile(keyPath, Buffer.alloc(32, 12).toString("base64"), { mode: 0o600 });
  for (const [payload, exitCode, code] of [
    [{ status: "error", code: "TURBO_PEER_BUSY", message: "arbitrary remote error" }, 0, "TURBO_PEER_BUSY"],
    [{ status: "error", message: "credential-path must never be returned" }, 0, "TURBO_PEER_REJECTED"],
    [{ status: "ok", accepted: true, enabled: true, millionContext: false }, 0, "TURBO_PEER_RESPONSE_INVALID"],
    [null, 1, "TURBO_PEER_UNREACHABLE"]
  ]) {
    const spawnImpl = () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      child.stdin.resume();
      child.stdin.on("finish", () => { child.stdout.end(JSON.stringify(payload)); queueMicrotask(() => child.emit("close", exitCode)); });
      return child;
    };
    const adapter = new SshPeerAdapter({ peer, actionKeyPath: keyPath, spawnImpl, logger: { warn() {} } });
    await assert.rejects(adapter.updateTurbo({ autoDisableGlobalRouting: true }), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(error.message, /credential-path/);
      return true;
    });
  }
});
