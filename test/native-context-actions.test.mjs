import test from "node:test";
import assert from "node:assert/strict";
import { drainNativeContextActions } from "../src/injector.mjs";

test("injector drains validated native toggle actions into the context store", async () => {
  const calls = [];
  const connection = {
    async evaluate() {
      return [
        { action: "set", threadId: "01a015ac-363f-7472-961a-f31d174ad2c8", contextWindow: 1_000_000 },
        { action: "remove", threadId: "019f6a9b-1a11-7777-8888-123456789abc" },
        { action: "set", threadId: "invalid", contextWindow: 1_000_000 }
      ];
    }
  };
  const store = {
    async set(threadId, contextWindow) { calls.push(["set", threadId, contextWindow]); },
    async remove(threadId) { calls.push(["remove", threadId]); }
  };
  const actions = await drainNativeContextActions(connection, store);
  assert.equal(actions.length, 2);
  assert.deepEqual(calls, [
    ["set", "01a015ac-363f-7472-961a-f31d174ad2c8", 1_000_000],
    ["remove", "019f6a9b-1a11-7777-8888-123456789abc"]
  ]);
});
