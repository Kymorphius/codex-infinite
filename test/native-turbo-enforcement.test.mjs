import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript } from "../src/native-turbo-injection.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

test("frozen native bridge applies and restores an authoritatively verified Turbo lease", async () => {
  const listeners = new Map();
  const storage = new Map();
  const applied = [];
  let native = { model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default", activePermissionProfile: { id: ":workspace" } };
  const bridge = { sendMessageFromView(message) {
    if (message?.request?.method === "thread/resume") queueMicrotask(() => {
      for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-response", hostId: "local", message: { id: message.request.id, result: { thread: { model: native.model, reasoningEffort: native.reasoningEffort }, ...native } } } });
    });
    return Promise.resolve();
  } };
  Object.freeze(bridge);
  const marker = { getAttribute() { return threadId; } };
  const document = { querySelector(selector) { return selector === "[data-above-composer-conversation-id]" ? marker : null; } };
  const window = {
    electronBridge: bridge,
    __codexControlConsoleGetContextWindow() { return 512000; },
    async __codexControlConsoleApplyThreadSettings(id, changes) { applied.push({ id, changes }); native = { ...native, model: changes.model, reasoningEffort: changes.reasoningEffort, serviceTier: changes.serviceTier, activePermissionProfile: { id: changes.permissionProfile || native.activePermissionProfile.id } }; return { applied: true }; },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const localStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, String(value)); } };
  const context = { window, document, localStorage, setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout, queueMicrotask, Math, Date, Map, Set, JSON };
  vm.runInNewContext(buildNativeTurboInjectionScript(), context);
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, active: true, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: true, accessMode: "full-access", modelEfforts: [{ model: "gpt-6-astra", effort: "ultra" }] }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(applied[0])), { id: threadId, changes: { model: "gpt-6-astra", reasoningEffort: "ultra", serviceTier: "priority", permissionProfile: ":danger-full-access", contextWindow: 1000000 } });
  assert.equal(window.__codexControlConsoleLastTurboEnforcement.ok, true);
  assert.equal(window.__codexControlConsoleLastTurboEnforcement.model, "gpt-6-astra");
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: true, accessMode: "full-access", modelEfforts: [{ model: "gpt-6-astra", effort: "ultra" }] }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(applied[1])), { id: threadId, changes: { model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default", contextWindow: 512000, permissionProfile: ":workspace" } });
  assert.equal(JSON.parse(storage.get("codex-control-console.turbo-setting-leases.v1")).length, 0);
});
