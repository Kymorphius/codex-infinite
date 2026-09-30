import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { SshProjectSyncAdapter } from "../src/ssh-project-sync-adapter.mjs";
import { PROJECT_SYNC_PACKAGE_BYTES, sshProjectSyncArguments } from "../src/project-sync-peer-commands.mjs";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";

const direct = { type: "direct-ssh", host: "host.example", user: "dev", port: 22, dashboardPort: 47831 };
const relay = { type: "ssh-relay", relayHost: "relay.example", relayUser: "dev", relayPort: 22, forwardedPort: 47832 };

async function fixture(t, replies, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ssh-project-sync-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const key = crypto.randomBytes(32);
  const actionKeyPath = path.join(root, "key");
  await fs.writeFile(actionKeyPath, key.toString("base64"), { mode: 0o600 });
  const calls = [];
  const logs = [];
  const spawnImpl = (command, args, options) => {
    const index = calls.length;
    const child = new EventEmitter();
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() { child.killed = true; } });
    const chunks = [];
    child.stdin.on("data", (chunk) => chunks.push(chunk));
    const call = { command, args, options, child };
    calls.push(call);
    child.stdin.on("finish", () => {
      call.body = Buffer.concat(chunks);
      queueMicrotask(() => {
        const reply = replies[index] || { status: "ok", result: {} };
        if (reply.pipeError) { child.stdin.emit("error", new Error("EPIPE private-key-material")); return; }
        if (reply.stderr) child.stderr.write(reply.stderr);
        if (reply.data !== undefined) child.stdout.write(reply.data);
        else child.stdout.write(JSON.stringify(reply));
        child.emit("close", reply.exitCode ?? 0);
      });
    });
    return child;
  };
  const adapter = new SshProjectSyncAdapter({ peer: { id: "remote", name: "远程设备", platform: "posix", transports: [direct, relay] }, actionKeyPath, spawnImpl, logger: { warn: (message) => logs.push(message) }, ...overrides });
  return { adapter, calls, logs, key };
}

function parseHeaders(args) {
  return Object.fromEntries(args.flatMap((arg, index) => arg === "-H" ? [args[index + 1].split(/:(.*)/s).slice(0, 2)] : []));
}

test("all actions send signed POST bodies unchanged and unwrap node results", async (t) => {
  const { adapter, calls, key } = await fixture(t, Array.from({ length: 5 }, (_, index) => ({ status: "ok", result: { index } })));
  for (const [index, action] of ["catalog", "inspect", "export", "prepare", "apply"].entries()) {
    const input = { path: "/Users/项目 path", arbitrary: { nested: "原样" } };
    assert.deepEqual(await adapter[action](input), { index });
    const call = calls[index];
    const headers = parseHeaders(call.args);
    const url = new URL(call.args.at(-1));
    assert.equal(url.pathname, `/api/node/project-sync/${action}`);
    assert.deepEqual(JSON.parse(call.body), action === "catalog" ? {} : input);
    assert.equal(headers[ACTION_HEADERS.signature], signPeerAction(key, { method: "POST", path: url.pathname, timestamp: headers[ACTION_HEADERS.timestamp], nonce: headers[ACTION_HEADERS.nonce], body: call.body }));
    assert.equal(call.args.includes(input.path), false);
    assert.equal(call.args.includes("@-"), true);
  }
});

test("reads fall back to another transport using a fresh replay nonce", async (t) => {
  const { adapter, calls, logs } = await fixture(t, [{ exitCode: 255, stderr: "private-key-material" }, { status: "ok", result: { projects: [] } }]);
  assert.deepEqual(await adapter.catalog(), { projects: [] });
  assert.equal(calls.length, 2);
  assert.notEqual(parseHeaders(calls[0].args)[ACTION_HEADERS.nonce], parseHeaders(calls[1].args)[ACTION_HEADERS.nonce]);
  assert.equal(logs.join(" ").includes("private-key-material"), false);
});

test("a successful signed read fallback selects the same configured route for a later mutation", async (t) => {
  const { adapter, calls, key } = await fixture(t, [
    { exitCode: 255 },
    { status: "ok", result: { operations: [] } },
    { status: "ok", result: { operationId: "existing-operation" } }
  ]);
  assert.deepEqual(await adapter.conversationOperations(), { operations: [] });
  assert.deepEqual(await adapter.conversationResume({ operationId: "existing-operation" }), { operationId: "existing-operation" });
  assert.equal(calls.length, 3);
  assert.ok(calls[0].args.includes("dev@host.example"));
  assert.ok(calls[1].args.includes("dev@relay.example"));
  assert.ok(calls[2].args.includes("dev@relay.example"));
  const headers = parseHeaders(calls[2].args);
  const pathname = new URL(calls[2].args.at(-1)).pathname;
  assert.equal(headers[ACTION_HEADERS.signature], signPeerAction(key, { method: "POST", path: pathname, timestamp: headers[ACTION_HEADERS.timestamp], nonce: headers[ACTION_HEADERS.nonce], body: calls[2].body }));
});

test("a failed mutation on a read-verified fallback route never tries another route", async (t) => {
  for (const reply of [{ exitCode: 255 }, { data: "invalid-json" }, { pipeError: true }]) {
    const { adapter, calls } = await fixture(t, [
      { exitCode: 255 },
      { status: "ok", result: { operations: [] } },
      reply,
      { status: "ok", result: { accidentallyRetried: true } }
    ]);
    await adapter.conversationOperations();
    await assert.rejects(adapter.conversationResume({ operationId: "existing-operation" }), (error) => error.code === "PROJECT_SYNC_RESULT_UNKNOWN");
    assert.equal(calls.length, 3);
    assert.ok(calls[2].args.includes("dev@relay.example"));
  }
});

test("malformed reads and explicit remote rejection do not select a fallback route", async (t) => {
  const { adapter, calls } = await fixture(t, [
    { data: "invalid-json" },
    { status: "error", message: "目标无法读取会话" },
    { status: "ok", result: { operationId: "existing-operation" } }
  ]);
  await assert.rejects(adapter.conversationOperations(), (error) => error.code === "PROJECT_SYNC_REJECTED");
  await adapter.conversationResume({ operationId: "existing-operation" });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].args.includes("dev@relay.example"));
  assert.ok(calls[2].args.includes("dev@host.example"));
});

test("a remote rejection on an already verified fallback clears its preference before the next mutation", async (t) => {
  const { adapter, calls } = await fixture(t, [
    { exitCode: 255 },
    { status: "ok", result: { operations: [] } },
    { status: "error", message: "目标暂时无法读取会话" },
    { status: "ok", result: { operationId: "existing-operation" } }
  ]);
  await adapter.conversationOperations();
  await assert.rejects(adapter.conversationOperations(), (error) => error.code === "PROJECT_SYNC_REJECTED");
  assert.equal(calls.length, 3);
  assert.ok(calls[2].args.includes("dev@relay.example"));
  await adapter.conversationResume({ operationId: "existing-operation" });
  assert.equal(calls.length, 4);
  assert.ok(calls[3].args.includes("dev@host.example"));
});

test("when all read routes fail the next mutation no longer prefers the previously verified fallback", async (t) => {
  const { adapter, calls } = await fixture(t, [
    { exitCode: 255 },
    { status: "ok", result: { operations: [] } },
    { exitCode: 255 },
    { exitCode: 255 },
    { status: "ok", result: { operationId: "existing-operation" } }
  ]);
  await adapter.conversationOperations();
  await assert.rejects(adapter.conversationOperations(), (error) => error.code === "PROJECT_SYNC_UNAVAILABLE");
  assert.equal(calls.length, 4);
  assert.ok(calls[2].args.includes("dev@relay.example"));
  assert.ok(calls[3].args.includes("dev@host.example"));
  await adapter.conversationResume({ operationId: "existing-operation" });
  assert.equal(calls.length, 5);
  assert.ok(calls[4].args.includes("dev@host.example"));
});

test("a verified fallback preference expires at 60 seconds and mutations do not extend it", async (t) => {
  const verifiedAt = 1_790_760_000_000;
  let now = verifiedAt;
  t.mock.method(Date, "now", () => now);
  t.after(() => t.mock.restoreAll());
  const { adapter, calls } = await fixture(t, [
    { exitCode: 255 },
    { status: "ok", result: { operations: [] } },
    { status: "ok", result: { operationId: "before-expiry" } },
    { status: "ok", result: { operationId: "at-expiry" } }
  ]);
  await adapter.conversationOperations();
  now = verifiedAt + 59_999;
  await adapter.conversationResume({ operationId: "before-expiry" });
  assert.equal(calls.length, 3);
  assert.ok(calls[2].args.includes("dev@relay.example"));
  now = verifiedAt + 60_000;
  await adapter.conversationResume({ operationId: "at-expiry" });
  assert.equal(calls.length, 4);
  assert.ok(calls[3].args.includes("dev@host.example"));
});

for (const action of ["prepare", "apply", "associate", "dissociate", "createPrepare", "createApply", "createResume", "conversationPrepare", "conversationApply", "conversationResume"]) {
  test(`${action} never retries after SSH failure, invalid response or EPIPE`, async (t) => {
    for (const reply of [{ exitCode: 255, stderr: "private-key-material" }, { data: "invalid-json" }, { pipeError: true }]) {
      const { adapter, calls } = await fixture(t, [reply]);
      await assert.rejects(adapter[action]({ path: "/project" }), (error) => error.code === "PROJECT_SYNC_RESULT_UNKNOWN" && /结果未知.*重新预检/.test(error.message) && !error.message.includes("private-key-material"));
      assert.equal(calls.length, 1);
    }
  });
}

test("explicit node rejection is reported without trying another transport", async (t) => {
  const { adapter, calls } = await fixture(t, [{ status: "error", message: "目标有未提交改动" }]);
  await assert.rejects(adapter.apply({}), /目标有未提交改动/);
  assert.equal(calls.length, 1);
});

test("older node endpoint errors explain the required upgrade and never retry mutations", async (t) => {
  for (const message of ["Method not allowed", "Not found"]) {
    for (const action of ["catalog", "prepare", "apply"]) {
      const { adapter, calls } = await fixture(t, [{ status: "error", message }]);
      await assert.rejects(adapter[action]({}), (error) => error.remoteRejected === true
        && error.code === "PROJECT_SYNC_REJECTED"
        && error.message === "该设备尚未提供项目同步功能，请先升级该设备的控制台");
      assert.equal(calls.length, 1);
    }
  }
});

test("export accepts package-sized replies and other responses remain bounded", async (t) => {
  const bundle = "a".repeat(32 * 1024 * 1024);
  const first = await fixture(t, [{ status: "ok", result: { bundleBase64: bundle } }]);
  assert.equal((await first.adapter.export({})).bundleBase64, bundle);
  const second = await fixture(t, [{ data: "a".repeat(70_000) }, { data: "a".repeat(70_000) }]);
  await assert.rejects(second.adapter.inspect({}), /无法读取/);
  assert.equal(second.calls.length, 2);
  assert.equal(second.calls.every(({ child }) => child.killed), true);
});

test("oversized export stops both safe read transports at the package bound", async (t) => {
  const oversized = "a".repeat(PROJECT_SYNC_PACKAGE_BYTES + 1);
  const { adapter, calls } = await fixture(t, [{ data: oversized }, { data: oversized }]);
  await assert.rejects(adapter.export({}), /无法读取/);
  assert.equal(calls.length, 2);
  assert.equal(calls.every(({ child }) => child.killed), true);
});

test("oversized small requests fail before SSH", async (t) => {
  const { adapter, calls } = await fixture(t, []);
  await assert.rejects(adapter.inspect({ path: "a".repeat(8192) }), (error) => error.statusCode === 413);
  assert.equal(calls.length, 0);
});

test("command builder validates shell inputs and uses Windows stdin UTF-8 on direct peers", () => {
  const headers = { [ACTION_HEADERS.timestamp]: "123456789", [ACTION_HEADERS.nonce]: "abcdefghijklmnop", [ACTION_HEADERS.signature]: "a".repeat(64) };
  const args = sshProjectSyncArguments(direct, headers, "prepare", { remotePlatform: "windows", bodyLength: 37 });
  const script = Buffer.from(args.at(-1), "base64").toString("utf16le");
  assert.doesNotMatch(script, /\[Console\]::(?:InputEncoding|OutputEncoding|In\.ReadToEnd)/);
  assert.match(script, /New-Object byte\[\] 37/);
  assert.match(script, /OpenStandardInput/);
  assert.match(script, /OpenStandardOutput/);
  assert.match(script, /Incomplete project sync request/);
  for (const bodyLength of [undefined, 0, -1, 1.5, PROJECT_SYNC_PACKAGE_BYTES + 1]) {
    assert.throws(() => sshProjectSyncArguments(direct, headers, "prepare", { remotePlatform: "windows", bodyLength }), /长度无效/);
  }
  assert.match(script, /\/api\/node\/project-sync\/prepare/);
  assert.equal(args.includes("powershell.exe"), true);
  assert.throws(() => sshProjectSyncArguments(direct, headers, "apply; touch /tmp/nope"));
  assert.throws(() => sshProjectSyncArguments({ ...direct, host: "host;env" }, headers, "apply"));
  assert.throws(() => sshProjectSyncArguments(direct, { ...headers, [ACTION_HEADERS.nonce]: "a'$(env)" }, "apply"));
  const viaRelay = sshProjectSyncArguments(relay, headers, "catalog", { remotePlatform: "windows" });
  assert.equal(viaRelay.includes("powershell.exe"), false);
  assert.equal(viaRelay.at(-1), "http://127.0.0.1:47832/api/node/project-sync/catalog");
});

test('Windows framing uses signed UTF-8 byte length, not JavaScript character count', async t => {
  const { adapter, calls } = await fixture(t, [{ status: 'ok', result: {} }], { peer: { id: 'windows', name: 'Windows', platform: 'windows', transports: [direct] } });
  await adapter.inspect({ path: 'C:\\中文项目\\文件' });
  const script = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le');
  assert.ok(calls[0].body.length > calls[0].body.toString('utf8').length);
  assert.ok(script.includes(`New-Object byte[] ${calls[0].body.length}`));
  assert.equal(script.includes('中文项目'), false);
});
