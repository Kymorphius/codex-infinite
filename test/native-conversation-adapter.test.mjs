import test from "node:test";
import assert from "node:assert/strict";
import { NativeConversationAdapter } from "../src/native-conversation-adapter.mjs";

function harness({ draft = "" } = {}) {
  const calls = [];
  let inserted = "";
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
    async send(method, params) { calls.push(["send", method, params]); inserted = params.text; },
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

test("native conversation adapter preserves an owner draft and never creates a second writer", async () => {
  const { adapter, calls } = harness({ draft: "owner is typing" });
  await assert.rejects(
    adapter.sendMessage({ threadId: "01a04445-8d03-7243-a4d3-181180bb626d", prompt: "remote" }),
    /尚未发送/
  );
  assert.equal(calls.some((call) => call[0] === "send"), false);
});
