import test from "node:test";
import assert from "node:assert/strict";
import { draftRevision, NativeConversationAdapter } from "../src/native-conversation-adapter.mjs";

function harness({ draft = "", approvals = [], approvalResult = { ok: true } } = {}) {
  const calls = [];
  let inserted = draft;
  const connection = {
    async connect() { calls.push(["connect"]); },
    async evaluate(expression) {
      calls.push(["evaluate", expression]);
      if (expression.includes("__codexControlConsoleReadPendingApprovals")) return { ok: true, items: approvals };
      if (expression.includes("__codexControlConsoleResolveApproval")) return approvalResult;
      if (expression.includes("__codexControlConsoleInterruptThread")) return { ok: true };
      if (expression.includes("navigate-to-route")) return true;
      if (expression.includes("data-app-action-sidebar-thread-id")) return { ready: true, draft };
      if (expression.includes("document.activeElement")) return true;
      if (expression.includes("send.click")) { inserted = ""; return true; }
      if (expression.includes("innerText")) return inserted;
      return true;
    },
    async send(method, params) {
      calls.push(["send", method, params]);
      if (method === "Input.insertText") inserted = params.text;
      if (method === "Input.dispatchKeyEvent" && params.key === "Backspace" && params.type === "keyDown") inserted = "";
    },
    async close() { calls.push(["close"]); }
  };
  const adapter = new NativeConversationAdapter({
    cdpOrigin: "http://127.0.0.1:9231",
    pollMs: 0,
    discover: async () => [{ id: "native" }],
    choose: () => ({ webSocketDebuggerUrl: "ws://127.0.0.1/native" }),
    connectionFactory: () => connection
  });
  return { adapter, calls };
}

test("native conversation adapter opens the exact owner thread and types through CDP", async () => {
  const { adapter, calls } = harness();
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  await adapter.sendMessage({ threadId, prompt: "native continuation" });
  assert.ok(calls.some((call) => call[0] === "evaluate" && call[1].includes(`/local/${threadId}`)));
  assert.deepEqual(calls.find((call) => call[0] === "send"), ["send", "Input.insertText", { text: "native continuation" }]);
  assert.equal(calls.at(-1)[0], "close");
});

test("native conversation adapter probes the complete desktop host without mutating it", async () => {
  const { adapter, calls } = harness();
  assert.equal(await adapter.probe(), true);
  assert.deepEqual(calls.map((call) => call[0]), ["connect", "close"]);
});

test("native conversation adapter reads and safely replaces an unchanged owner draft", async () => {
  const { adapter, calls } = harness({ draft: "owner is typing" });
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  assert.deepEqual(await adapter.readDraft(threadId), { text: "owner is typing", revision: draftRevision("owner is typing") });
  await adapter.sendMessage({ threadId, prompt: "owner is typing, continued remotely", expectedDraftRevision: draftRevision("owner is typing") });
  assert.ok(calls.some((call) => call[0] === "send" && call[1] === "Input.dispatchKeyEvent"));
});

test("native conversation adapter rejects a stale draft revision without changing the composer", async () => {
  const { adapter, calls } = harness({ draft: "new owner draft" });
  await assert.rejects(adapter.sendMessage({
    threadId: "01a04445-8d03-7243-a4d3-181180bb626d",
    prompt: "remote edit",
    expectedDraftRevision: draftRevision("old owner draft")
  }), /已经变化/);
  assert.equal(calls.some((call) => call[0] === "send"), false);
});

test("native conversation adapter interrupts only an exact owner turn through the desktop bridge", async () => {
  const { adapter, calls } = harness();
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";
  await adapter.interruptTurn({ threadId, turnId });
  const expression = calls.find((call) => call[0] === "evaluate")[1];
  assert.match(expression, /__codexControlConsoleInterruptThread/);
  assert.match(expression, new RegExp(threadId));
  assert.match(expression, new RegExp(turnId));
  await assert.rejects(() => adapter.interruptTurn({ threadId, turnId: "bad" }), /标识无效/);
});

test("native conversation adapter reads only validated approvals for the exact owner thread", async () => {
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const approvals = [{
    token: "01a04447-8d03-7243-a4d3-181180bb626f",
    kind: "command",
    threadId,
    turnId: "01a04446-8d03-7243-a4d3-181180bb626e",
    itemId: "item-1",
    startedAtMs: Date.now(),
    reason: "执行测试",
    command: "npm test",
    cwd: "/workspace",
    networkHost: null,
    permissionSummary: [],
    decisions: ["accept", "decline"]
  }];
  const { adapter, calls } = harness({ approvals });
  assert.equal((await adapter.readPendingApprovals(threadId))[0].command, "npm test");
  assert.ok(calls.some((call) => call[0] === "evaluate" && call[1].includes("__codexControlConsoleReadPendingApprovals")));
});

test("native conversation adapter resolves an exact one-turn approval through the desktop bridge", async () => {
  const { adapter, calls } = harness();
  const input = {
    threadId: "01a04445-8d03-7243-a4d3-181180bb626d",
    turnId: "01a04446-8d03-7243-a4d3-181180bb626e",
    approvalToken: "01a04447-8d03-7243-a4d3-181180bb626f",
    decision: "decline"
  };
  assert.equal((await adapter.resolveApproval(input)).approvalResolved, true);
  const expression = calls.find((call) => call[0] === "evaluate")[1];
  assert.match(expression, /__codexControlConsoleResolveApproval/);
  assert.match(expression, /"decline"/);
  await assert.rejects(() => adapter.resolveApproval({ ...input, decision: "acceptForSession" }), /操作无效/);

  const rejected = harness({ approvalResult: { ok: false, message: "审批已在本机处理" } }).adapter;
  await assert.rejects(() => rejected.resolveApproval(input), /已在本机处理/);
});
