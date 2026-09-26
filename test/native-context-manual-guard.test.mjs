import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeContextInjectionScript } from "../src/native-context-injection.mjs";

const THREAD_ID = "01a015ac-363f-7472-961a-f31d174ad2c8";
const changes = { model: "gpt-6-astra", reasoningEffort: "ultra", contextWindow: 1_000_000 };

function runtime() {
  const requests = [];
  const listeners = new Set();
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute() {}, remove() {} }),
    addEventListener() {},
    head: { append() {} },
    documentElement: {}
  };
  const window = {
    electronBridge: { sendMessageFromView(message) { requests.push(message.request); } },
    addEventListener(type, listener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type, listener) { if (type === "message") listeners.delete(listener); }
  };
  vm.runInNewContext(buildNativeContextInjectionScript(), {
    window, document, localStorage: { getItem: () => null },
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask() {}
  });
  return {
    window, requests,
    apply: (options) => window.__codexControlConsoleApplyThreadSettings(THREAD_ID, changes, options),
    async respond(index, result = {}, error) {
      const message = { id: requests[index].id, ...(error ? { error: { message: error } } : { result }) };
      for (const listener of [...listeners]) listener({ data: { type: "mcp-response", hostId: "local", message } });
      await new Promise((resolve) => setImmediate(resolve));
    },
    context: () => window.__codexControlConsoleGetContextWindow(THREAD_ID),
    methods: () => requests.map(({ method }) => method)
  };
}

function assertSuperseded(result) {
  assert.equal(result.applied, false);
  assert.equal(result.threadId, THREAD_ID);
  assert.equal(result.reason, "superseded");
}

test("manual guard rejects a stale apply before any RPC or metadata write", async () => {
  const r = runtime();
  assertSuperseded(await r.apply({ shouldApply: () => false }));
  assert.deepEqual(r.methods(), []);
  assert.equal(r.context(), null);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings, undefined);
  assert.equal(r.window.__codexControlConsoleLastContextResume, undefined);
});

test("manual choice during settings update prevents context resume and local overrides", async () => {
  const r = runtime();
  let current = true;
  const pending = r.apply({ shouldApply: () => current });
  assert.deepEqual(r.methods(), ["thread/settings/update"]);
  current = false;
  await r.respond(0);
  assertSuperseded(await pending);
  assert.deepEqual(r.methods(), ["thread/settings/update"]);
  assert.equal(r.context(), null);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings, undefined);
  assert.equal(r.window.__codexControlConsoleLastContextResume, undefined);
});

test("manual choice during context resume preserves earlier overrides and success metadata", async () => {
  const r = runtime();
  const prior = { threadId: THREAD_ID, old: true };
  r.window.__codexControlConsoleSetContextOverrides([{ threadId: THREAD_ID, contextWindow: 32000 }]);
  r.window.__codexControlConsoleLastContextResume = prior;
  r.window.__codexControlConsoleLastThreadSettings = prior;
  let current = true;
  const pending = r.apply({ shouldApply: () => current });
  await r.respond(0);
  assert.deepEqual(r.methods(), ["thread/settings/update", "thread/resume"]);
  current = false;
  await r.respond(1);
  assertSuperseded(await pending);
  assert.equal(r.context(), 32000);
  assert.equal(r.window.__codexControlConsoleLastContextResume, prior);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings, prior);
});

test("manual choice before a missing-thread response prevents recovery resume", async () => {
  const r = runtime();
  let current = true;
  const pending = r.apply({ shouldApply: () => current });
  current = false;
  await r.respond(0, null, "thread not found");
  assertSuperseded(await pending);
  assert.deepEqual(r.methods(), ["thread/settings/update"]);
});

test("manual choice during missing-thread recovery prevents retry and metadata", async () => {
  const r = runtime();
  let current = true;
  const pending = r.apply({ shouldApply: () => current });
  await r.respond(0, null, "thread not found");
  assert.deepEqual(r.methods(), ["thread/settings/update", "thread/resume"]);
  current = false;
  await r.respond(1);
  assertSuperseded(await pending);
  assert.deepEqual(r.methods(), ["thread/settings/update", "thread/resume"]);
  assert.equal(r.context(), null);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings, undefined);
  assert.equal(r.window.__codexControlConsoleLastContextResume, undefined);
});

test("callers without a guard keep applying native settings and context", async () => {
  const r = runtime();
  const pending = r.apply();
  await r.respond(0, { updated: true });
  assert.deepEqual(r.methods(), ["thread/settings/update", "thread/resume"]);
  assert.equal(r.requests[0].params.model, changes.model);
  assert.equal(r.requests[0].params.effort, changes.reasoningEffort);
  assert.equal(r.requests[1].params.model, changes.model);
  assert.equal(r.requests[1].params.config.model_reasoning_effort, changes.reasoningEffort);
  assert.equal(r.requests[1].params.config.model_context_window, 1_000_000);
  await r.respond(1);
  const result = await pending;
  assert.equal(result.applied, true);
  assert.equal(r.context(), 1_000_000);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings.ok, true);
  assert.equal(r.window.__codexControlConsoleLastContextResume.ok, true);
});

test("callers without a guard still recover a missing thread and retry once", async () => {
  const r = runtime();
  const pending = r.window.__codexControlConsoleApplyThreadSettings(THREAD_ID, { model: changes.model });
  await r.respond(0, null, "thread not found");
  await r.respond(1);
  assert.deepEqual(r.methods(), ["thread/settings/update", "thread/resume", "thread/settings/update"]);
  await r.respond(2);
  assert.equal((await pending).applied, true);
  assert.equal(r.window.__codexControlConsoleLastThreadSettings.ok, true);
});

test("manual guard does not weaken existing input validation", async () => {
  const r = runtime();
  await assert.rejects(
    r.window.__codexControlConsoleApplyThreadSettings(THREAD_ID, { model: "invalid model" }, { shouldApply: () => false }),
    /模型无效/
  );
  assert.deepEqual(r.methods(), []);
});
