import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeChatgptProjectLookupExpression, NativeChatgptProjectAdapter } from "../src/native-chatgpt-project-adapter.mjs";

const conversationId = "6a7aa82f-d580-83ea-86a0-67d64269d4e5";
const projectId = "g-p-6a7aad520e408191bf0633cb7976dace";
const movable = { found: true, source: "chatgpt", conversationOrigin: null, projectId: null, rowAvailable: true, moveActionAvailable: true };

function adapterWith(results, extras = {}) {
  const calls = [];
  let closed = 0;
  const connection = {
    async connect() { calls.push("connect"); },
    async evaluate(expression) { calls.push(expression); return results.shift(); },
    async close() { closed += 1; }
  };
  const adapter = new NativeChatgptProjectAdapter({
    cdpOrigin: "http://127.0.0.1:9231",
    async discover() { return [{ webSocketDebuggerUrl: "ws://target" }]; },
    choose(targets) { return targets[0]; },
    connectionFactory() { return connection; },
    wait: async () => {},
    ...extras
  });
  return { adapter, calls, get closed() { return closed; } };
}

test("native ChatGPT project adapter invokes the exact native action and verifies projectId", async () => {
  const harness = adapterWith([movable, { ...movable, invoked: true }, { ...movable, projectId }]);
  assert.deepEqual(await harness.adapter.move({ conversationId, projectId }), {
    applied: true, alreadyApplied: false, conversationId, projectId
  });
  assert.equal(harness.closed, 1);
  assert.match(harness.calls[1], /move-chatgpt-conversation-to-project/);
  assert.match(harness.calls[2], /action\.onSelect\(\)/);
  assert.match(harness.calls[2], new RegExp(projectId));
});

test("native ChatGPT project adapter returns idempotent success without invoking", async () => {
  const harness = adapterWith([{ ...movable, projectId, moveActionAvailable: false }]);
  assert.deepEqual(await harness.adapter.move({ conversationId, projectId }), {
    applied: false, alreadyApplied: true, conversationId, projectId
  });
  assert.equal(harness.calls.filter((call) => typeof call === "string" && call.startsWith("(async ()")).length, 1);
  assert.equal(harness.closed, 1);
});

test("native ChatGPT project adapter fails closed for cloud Work and closes", async () => {
  const harness = adapterWith([{ found: true, source: "codex", conversationOrigin: "tpp", projectId: null, moveActionAvailable: true }]);
  await assert.rejects(() => harness.adapter.move({ conversationId, projectId }), /只能移动普通 ChatGPT 聊天/);
  assert.equal(harness.closed, 1);
});

test("native ChatGPT project adapter times out without stale success", async () => {
  const harness = adapterWith([movable, { ...movable, invoked: true }, movable, movable], { verifyAttempts: 2 });
  await assert.rejects(() => harness.adapter.move({ conversationId, projectId }), /归属更新超时/);
  assert.equal(harness.closed, 1);
});

test("native ChatGPT project adapter validates before opening CDP and serializes moves", async () => {
  let discovered = 0;
  const adapter = new NativeChatgptProjectAdapter({ async discover() { discovered += 1; return []; } });
  await assert.rejects(() => adapter.move({ conversationId: "bad", projectId }), /会话标识无效/);
  assert.equal(discovered, 0);

  let active = 0;
  let maximum = 0;
  const queued = new NativeChatgptProjectAdapter();
  queued.moveOne = async ({ conversationId: id }) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return id;
  };
  assert.deepEqual(await Promise.all([
    queued.move({ conversationId, projectId }),
    queued.move({ conversationId: "6a945edf-1a5c-83e8-8259-fbaddce63cf6", projectId })
  ]), [conversationId, "6a945edf-1a5c-83e8-8259-fbaddce63cf6"]);
  assert.equal(maximum, 1);
});

test("native ChatGPT renderer lookup is bounded to IDs and native menu callbacks", () => {
  const source = buildNativeChatgptProjectLookupExpression(conversationId, projectId, { invoke: true });
  assert.match(source, /data-sidebar-chatgpt-conversation-key/);
  assert.match(source, /data-thread-title/);
  assert.match(source, /memoizedProps\?\.conversationId/);
  assert.match(source, /sourceFiber\.memoizedProps\?\.chatGptSource/);
  assert.match(source, /conversation_origin/);
  assert.match(source, /move-chatgpt-conversation-to-project/);
  assert.match(source, /await Promise\.resolve\(action\.onSelect\(\)\)/);
  assert.doesNotMatch(source, /fetch\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
});
