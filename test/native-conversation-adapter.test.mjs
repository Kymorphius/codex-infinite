import test from "node:test";
import assert from "node:assert/strict";
import { draftRevision, NativeConversationAdapter } from "../src/native-conversation-adapter.mjs";

function harness({ draft = "" } = {}) {
  const calls = [];
  let inserted = draft;
  const connection = {
    async connect() { calls.push(["connect"]); },
    async evaluate(expression) {
      calls.push(["evaluate", expression]);
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
