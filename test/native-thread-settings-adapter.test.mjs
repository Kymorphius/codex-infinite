import test from "node:test";
import assert from "node:assert/strict";
import { NativeThreadSettingsAdapter } from "../src/native-thread-settings-adapter.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

test("native settings adapter invokes the bounded desktop bridge and closes CDP", async () => {
  const calls = [];
  const connection = {
    async connect() { calls.push("connect"); },
    async evaluate(expression) { calls.push(expression); return { ok: true }; },
    async close() { calls.push("close"); }
  };
  const adapter = new NativeThreadSettingsAdapter({
    cdpOrigin: "http://127.0.0.1:9231",
    async discover() { return [{ type: "page", webSocketDebuggerUrl: "ws://target" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() { return connection; }
  });
  assert.deepEqual(await adapter.apply({ threadId, changes: { reasoningEffort: "high" } }), {
    applied: true, threadId, ownerSurface: "dedicated-native", ownerBridge: "direct"
  });
  assert.equal(calls[0], "connect");
  assert.match(calls[1], /__codexControlConsoleApplyThreadSettings/);
  assert.match(calls[1], new RegExp(threadId));
  assert.match(calls[1], /reasoningEffort/);
  assert.equal(calls.at(-1), "close");
});

test("native settings adapter fails closed on invalid ids and owner rejection", async () => {
  const adapter = new NativeThreadSettingsAdapter({
    cdpOrigin: "http://127.0.0.1:9231",
    async discover() { return [{ webSocketDebuggerUrl: "ws://target" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() {
      return { async connect() {}, async evaluate() { return { ok: false, message: "unsupported" }; }, async close() {} };
    }
  });
  await assert.rejects(() => adapter.apply({ threadId: "bad", changes: {} }), /标识无效/);
  await assert.rejects(() => adapter.apply({ threadId, changes: { model: "x" } }), /unsupported/);
});

test("native settings adapter explains the active-writer boundary without exposing a stale success", async () => {
  const adapter = new NativeThreadSettingsAdapter({
    cdpOrigin: "http://127.0.0.1:9231",
    async discover() { return [{ webSocketDebuggerUrl: "ws://target" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() {
      return {
        async connect() {},
        async evaluate() { return { ok: false, message: `thread ${threadId} already has an active writer` }; },
        async close() {}
      };
    }
  });
  await assert.rejects(() => adapter.apply({ threadId, changes: { serviceTier: "priority" } }), /原生 ChatGPT 中运行.*真实设置仍会同步显示/);
});

test("native settings adapter reports the writer-owning surface selected by the router", async () => {
  let closed = false;
  const adapter = new NativeThreadSettingsAdapter({
    router: {
      async connect(id) {
        assert.equal(id, threadId);
        return {
          ownerSurface: "primary-native",
          ownerBridge: "writer-matched",
          connection: { async evaluate() { return { ok: true }; }, async close() { closed = true; } }
        };
      }
    }
  });
  assert.deepEqual(await adapter.apply({ threadId, changes: { reasoningEffort: "medium" } }), {
    applied: true, threadId, ownerSurface: "primary-native", ownerBridge: "writer-matched"
  });
  assert.equal(closed, true);
});
