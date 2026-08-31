import test from "node:test";
import assert from "node:assert/strict";
import { RemoteMessageService, validateRemoteControl, validateRemoteMessage } from "../src/remote-message-service.mjs";

test("remote messaging validates bounded thread and prompt contracts", () => {
  assert.deepEqual(validateRemoteMessage({ threadId: "thread-1", prompt: "  continue\nnow  " }), { threadId: "thread-1", prompt: "continue\nnow", expectedDraftRevision: null });
  assert.throws(() => validateRemoteMessage({ threadId: "bad;id", prompt: "go" }), /标识/);
  assert.throws(() => validateRemoteMessage({ threadId: "thread-1", prompt: " " }), /不能为空/);
  assert.throws(() => validateRemoteMessage({ threadId: "thread-1", prompt: "x".repeat(12_001) }), /过长/);
});

test("remote control accepts only exact interrupt or one-turn approval contracts", () => {
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";
  const approvalToken = "01a04447-8d03-7243-a4d3-181180bb626f";
  assert.deepEqual(validateRemoteControl({ threadId, turnId, action: "interrupt" }), { threadId, turnId, action: "interrupt" });
  assert.deepEqual(validateRemoteControl({ threadId, turnId, action: "resolveApproval", approvalToken, decision: "accept" }), {
    threadId, turnId, action: "resolveApproval", approvalToken, decision: "accept"
  });
  assert.throws(() => validateRemoteControl({ threadId, turnId, action: "delete" }), /操作无效/);
  assert.throws(() => validateRemoteControl({ threadId, turnId: "bad", action: "interrupt" }), /轮次/);
  assert.throws(() => validateRemoteControl({ threadId, turnId, action: "resolveApproval", approvalToken, decision: "acceptForSession" }), /审批操作无效/);
});

test("owner service submits through the owner native UI and prevents concurrent remote writers", async () => {
  let release;
  const dispatched = [];
  const service = new RemoteMessageService({
    localAdapter: { async getTask(id) { return id === "thread-1" ? { id, cwd: "/work/owner" } : null; } },
    nativeConversationAdapter: { sendMessage(item) { dispatched.push(item); return new Promise((resolve) => { release = resolve; }); } },
    idFactory: () => "request-1"
  });
  const first = service.submit({ threadId: "thread-1", prompt: "continue" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(dispatched[0], { threadId: "thread-1", prompt: "continue", expectedDraftRevision: null });
  await assert.rejects(() => service.submit({ threadId: "thread-1", prompt: "again" }), (error) => error.statusCode === 409);
  release();
  const result = await first;
  assert.equal(result.requestId, "request-1");
  assert.equal(result.executionAuthority, "owner-native-desktop");
  await assert.rejects(() => service.submit({ threadId: "missing", prompt: "go" }), (error) => error.statusCode === 404);
});

test("owner service interrupts only a currently active native turn", async () => {
  const calls = [];
  const service = new RemoteMessageService({
    localAdapter: { async getTask(id) { return id.endsWith("d") ? { id, status: "active" } : { id, status: "completed" }; } },
    nativeConversationAdapter: { async interruptTurn(input) { calls.push(input); } }
  });
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";
  const result = await service.interrupt({ threadId, turnId, action: "interrupt" });
  assert.equal(result.interrupted, true);
  assert.deepEqual(calls, [{ threadId, turnId }]);
  await assert.rejects(() => service.interrupt({ threadId: "01a04445-8d03-7243-a4d3-181180bb626e", turnId, action: "interrupt" }), (error) => error.statusCode === 409);
});

test("owner service reads and resolves approval capabilities through the native desktop only", async () => {
  const calls = [];
  const approvals = [{ token: "opaque" }];
  const service = new RemoteMessageService({
    localAdapter: { async getTask(id) { return { id, status: "active" }; } },
    nativeConversationAdapter: {
      async readPendingApprovals(id) { calls.push(["read", id]); return approvals; },
      async resolveApproval(input) { calls.push(["resolve", input]); return { approvalResolved: true }; }
    }
  });
  const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
  const turnId = "01a04446-8d03-7243-a4d3-181180bb626e";
  const approvalToken = "01a04447-8d03-7243-a4d3-181180bb626f";
  assert.equal(await service.readPendingApprovals(threadId), approvals);
  const result = await service.control({ threadId, turnId, action: "resolveApproval", approvalToken, decision: "decline" });
  assert.equal(result.approvalResolved, true);
  assert.equal(result.executionAuthority, "owner-native-desktop");
  assert.deepEqual(calls, [
    ["read", threadId],
    ["resolve", { threadId, turnId, approvalToken, decision: "decline" }]
  ]);
});
