import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeApprovalInjectionScript } from "../src/native-approval-injection.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";

function harness() {
  const listeners = new Map();
  const sent = [];
  let sequence = 100;
  const window = {
    addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); },
    electronBridge: {
      async sendMessageFromView(message) { sent.push(message); }
    }
  };
  vm.runInNewContext(buildNativeApprovalInjectionScript(), {
    window,
    crypto: { randomUUID: () => `01a04447-8d03-7243-a4d3-181180bb6${String(sequence++).padStart(3, "0")}` },
    console,
    Date,
    JSON,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Promise
  });
  const emit = (data) => { for (const listener of listeners.get("message") || []) listener({ data }); };
  return { window, sent, emit };
}

function request(method, params = {}, id = "native-request-secret") {
  return {
    type: "mcp-request",
    hostId: "local",
    request: {
      id,
      method,
      params: {
        threadId,
        turnId,
        itemId: "item-1",
        startedAtMs: Date.now(),
        ...params
      }
    }
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("native approval injection captures a redacted command capability and derives the response", async () => {
  const { window, sent, emit } = harness();
  emit(request("item/commandExecution/requestApproval", {
    command: "npm test",
    cwd: "/workspace/project",
    reason: "运行测试",
    environmentId: "secret-environment",
    availableDecisions: ["accept", "acceptForSession", "decline"]
  }));
  const pending = plain(window.__codexControlConsoleReadPendingApprovals(threadId));
  assert.equal(pending.length, 1);
  assert.deepEqual(pending[0].decisions, ["accept", "decline"]);
  assert.equal(pending[0].command, "npm test");
  assert.doesNotMatch(JSON.stringify(pending), /native-request-secret|secret-environment|acceptForSession/);

  await window.__codexControlConsoleResolveApproval(threadId, turnId, pending[0].token, "accept");
  assert.deepEqual(plain(sent), [{
    type: "mcp-response",
    hostId: "local",
    response: { id: "native-request-secret", result: { decision: "accept" } }
  }]);
  assert.deepEqual(plain(window.__codexControlConsoleReadPendingApprovals(threadId)), []);
  await assert.rejects(() => window.__codexControlConsoleResolveApproval(threadId, turnId, pending[0].token, "decline"), /失效/);
});

test("native approval injection grants only the originally requested permissions for one turn", async () => {
  const { window, sent, emit } = harness();
  const permissions = {
    network: { enabled: true },
    fileSystem: { entries: [{ access: "write", path: { type: "path", path: "/workspace/output" } }] }
  };
  emit(request("item/permissions/requestApproval", { cwd: "/workspace", reason: "生成文件", permissions }, 42));
  const [pending] = plain(window.__codexControlConsoleReadPendingApprovals(threadId));
  assert.deepEqual(pending.permissionSummary, ["访问网络", "写入 /workspace/output"]);

  await window.__codexControlConsoleResolveApproval(threadId, turnId, pending.token, "accept");
  assert.deepEqual(plain(sent[0].response), { id: 42, result: { permissions, scope: "turn" } });

  emit(request("item/permissions/requestApproval", { cwd: "/workspace", permissions }, 43));
  const [declined] = plain(window.__codexControlConsoleReadPendingApprovals(threadId));
  await window.__codexControlConsoleResolveApproval(threadId, turnId, declined.token, "decline");
  assert.deepEqual(plain(sent[1].response), { id: 43, result: { permissions: {}, scope: "turn" } });
});

test("native approval injection removes requests resolved by native UI or completed lifecycle", () => {
  const { window, emit } = harness();
  emit(request("item/fileChange/requestApproval", { reason: "修改文件" }, "file-1"));
  assert.equal(window.__codexControlConsoleReadPendingApprovals(threadId).length, 1);
  emit({ type: "mcp-notification", hostId: "local", request: { method: "serverRequest/resolved", params: { threadId, requestId: "file-1" } } });
  assert.equal(window.__codexControlConsoleReadPendingApprovals(threadId).length, 0);

  emit(request("item/commandExecution/requestApproval", { command: "pwd" }, "command-2"));
  emit({ type: "mcp-notification", hostId: "local", request: { method: "item/completed", params: { threadId, turnId, item: { id: "item-1" } } } });
  assert.equal(window.__codexControlConsoleReadPendingApprovals(threadId).length, 0);

  emit(request("item/commandExecution/requestApproval", { command: "pwd" }, "command-3"));
  emit({ type: "mcp-notification", hostId: "local", request: { method: "turn/completed", params: { threadId, turn: { id: turnId } } } });
  assert.equal(window.__codexControlConsoleReadPendingApprovals(threadId).length, 0);
});

test("native approval injection ignores other hosts, unsupported requests, and unavailable one-turn decisions", () => {
  const { window, emit } = harness();
  emit({ ...request("item/fileChange/requestApproval"), hostId: "peer" });
  emit(request("item/tool/requestUserInput", {}));
  emit(request("item/commandExecution/requestApproval", { command: "pwd", availableDecisions: ["acceptForSession", "cancel"] }));
  assert.deepEqual(plain(window.__codexControlConsoleReadPendingApprovals(threadId)), []);
});
