import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  applyNativeTurboAction,
  buildNativeTurboInjectionScript,
  buildNativeTurboSnapshotScript,
  NATIVE_TURBO_BINDING,
  parseNativeTurboAction
} from "../src/native-turbo-injection.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

function runtime() {
  const sent = [];
  const listeners = new Map();
  const window = {
    electronBridge: { sendMessageFromView(message) {
      sent.push(message);
      if (message?.request?.method === "thread/resume") queueMicrotask(() => {
        for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-response", hostId: "local", message: { id: message.request.id, result: {} } } });
      });
      return Promise.resolve();
    } },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const document = { querySelector() { return null; } };
  const storage = new Map();
  const localStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, String(value)); } };
  const context = { window, document, localStorage, setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout, queueMicrotask, Math, Date, Map, Set, JSON };
  vm.runInNewContext(buildNativeTurboInjectionScript(), context);
  return { context, window, sent };
}

test("Turbo clones turn/start and applies model maximum plus Fast without changing sticky settings", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({
    enabled: true,
    modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }]
  }), context);
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", input: [] } } };
  await window.electronBridge.sendMessageFromView(request);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(request.request.params.effort, "medium");
  assert.equal(request.request.params.serviceTierForTurn, undefined);
  assert.equal(sent[0].request.params.effort, "ultra");
  assert.equal(sent[0].request.params.serviceTierForTurn, "priority");
  assert.equal(sent.length, 1);
});

test("Turbo million context resumes before the turn and restores the ordinary context on the next non-Turbo turn", async () => {
  const { context, window, sent } = runtime();
  window.__codexControlConsoleGetContextWindow = () => 512_000;
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", input: [] } } };
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, millionContext: true, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[0].request.method, "thread/resume");
  assert.equal(sent[0].request.params.config.model_context_window, 1_000_000);
  assert.equal(sent[1].request.method, "turn/start");
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false, millionContext: true, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[2].request.method, "thread/resume");
  assert.equal(sent[2].request.params.config.model_context_window, 512_000);
  assert.equal(sent[3], request);
});

test("Turbo respects collaboration mode precedence without changing its instructions", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, modelEfforts: [{ model: "gpt-5.6-luna", effort: "max" }] }), context);
  const collaborationMode = { mode: "default", settings: { model: "gpt-5.6-luna", reasoning_effort: "low", developer_instructions: "keep" } };
  await window.electronBridge.sendMessageFromView({ type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, collaborationMode, input: [] } } });
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(sent[0].request.params.collaborationMode.settings.reasoning_effort, "max");
  assert.equal(sent[0].request.params.collaborationMode.settings.developer_instructions, "keep");
  assert.equal(sent.length, 1);
});

test("Turbo fixed strategy overrides model, effort, and access while Fast can remain native", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({
    enabled: true, active: true, model: "gpt-5.6-luna", reasoningEffort: "high", fast: false,
    accessMode: "read-only", modelEfforts: [{ model: "gpt-5.6-luna", effort: "max" }]
  }), context);
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", permissions: ":danger-full-access", input: [] } } };
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[0].request.params.model, "gpt-5.6-luna");
  assert.equal(sent[0].request.params.effort, "high");
  assert.equal(sent[0].request.params.permissions, ":read-only");
  assert.equal(sent[0].request.params.serviceTierForTurn, undefined);
  assert.equal(request.request.params.model, "gpt-5.6-sol");
});

test("Turbo leaves a node outside the configured device range untouched", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, active: false, fast: true, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "low", input: [] } } };
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[0], request);
});

test("disabled Turbo leaves the exact native request untouched and sends no restore", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "low", input: [] } } };
  await window.electronBridge.sendMessageFromView(request);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0], request);
});

test("disabling Turbo restores the next turn to the native conversation settings", async () => {
  const { context, window, sent } = runtime();
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", permissions: ":danger-full-access", input: [] } } };
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, accessMode: "read-only", modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  await window.electronBridge.sendMessageFromView(request);
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[0].request.params.effort, "ultra");
  assert.equal(sent[0].request.params.permissions, ":read-only");
  assert.equal(sent[1], request);
  assert.equal(sent[1].request.params.effort, "medium");
  assert.equal(sent[1].request.params.permissions, ":danger-full-access");
});

test("native sidebar Turbo control uses one bounded binding action", async () => {
  const source = buildNativeTurboInjectionScript();
  assert.match(source, /data-codex-control-console-native-turbo/);
  assert.match(source, /data-codex-control-console-turbo-effective/);
  assert.match(source, /data-codex-control-console-native-turbo-settings/);
  assert.match(source, /百万上下文/);
  assert.match(source, /data-composer-navigation-target="reasoning"/);
  assert.match(source, /Fast/);
  assert.match(source, /button\[aria-label="搜索"\]/);
  assert.match(source, new RegExp(NATIVE_TURBO_BINDING));
  assert.deepEqual(parseNativeTurboAction('{"enabled":true}'), { enabled: true });
  assert.deepEqual(parseNativeTurboAction('{"millionContext":true}'), { millionContext: true });
  assert.deepEqual(parseNativeTurboAction('{"model":"gpt-5.6-luna","reasoningEffort":"max","fast":false,"accessMode":"workspace","deviceIds":["matrix-air"]}'), { model: "gpt-5.6-luna", reasoningEffort: "max", fast: false, accessMode: "workspace", deviceIds: ["matrix-air"] });
  assert.equal(parseNativeTurboAction('{"enabled":true,"extra":1}'), null);
  let received = null;
  const result = await applyNativeTurboAction('{"enabled":false}', { async update(change) { received = change; return change; } });
  assert.deepEqual(received, { enabled: false });
  assert.deepEqual(result, { enabled: false });
});
