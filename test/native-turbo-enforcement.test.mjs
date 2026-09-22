import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript } from "../src/native-turbo-injection.mjs";
import { buildNativeTurboEnforcementSource } from "../src/native-turbo-enforcement.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

test("frozen native bridge applies and restores an authoritatively verified Turbo lease", async () => {
  const listeners = new Map();
  const storage = new Map();
  const applied = [];
  let contextWindow = 512000;
  let native = { model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default", activePermissionProfile: { id: ":workspace" } };
  const bridge = { sendMessageFromView(message) {
    if (message?.request?.method === "thread/resume") queueMicrotask(() => {
      for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-response", hostId: "local", message: { id: message.request.id, result: { thread: { model: native.model, reasoningEffort: native.reasoningEffort }, ...native } } } });
    });
    return Promise.resolve();
  } };
  Object.freeze(bridge);
  const marker = { getAttribute() { return threadId; } };
  const document = { querySelector(selector) { return selector === "[data-above-composer-conversation-id]" ? marker : null; }, querySelectorAll() { return []; } };
  const window = {
    electronBridge: bridge,
    __codexControlConsoleGetContextWindow() { return contextWindow; },
    async __codexControlConsoleApplyThreadSettings(id, changes) { applied.push({ id, changes }); if (Object.hasOwn(changes, 'contextWindow')) contextWindow = changes.contextWindow; native = { ...native, model: changes.model, reasoningEffort: changes.reasoningEffort, serviceTier: changes.serviceTier, activePermissionProfile: { id: changes.permissionProfile || native.activePermissionProfile.id } }; return { applied: true }; },
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
  const turnId = "01a04445-8d03-7243-a4d3-181180bb626e";
  const notify = (id) => { for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-notification", hostId: "local", method: "turn/started", params: { threadId, turn: { id } } } }); };
  notify(turnId);
  const receipt = JSON.parse(storage.get("codex-control-console.turbo-turn-receipts.v1"))[0];
  assert.deepEqual({ ...receipt, recordedAt: 0 }, { threadId, turnId, model: "gpt-6-astra", effort: "ultra", serviceTier: "priority", contextWindow: 1000000, source: "native-settings", recordedAt: 0 });
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: false, accessMode: "full-access" }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  notify("01a04445-8d03-7243-a4d3-181180bb626f");
  assert.equal(JSON.parse(storage.get("codex-control-console.turbo-turn-receipts.v1")).at(-1).contextWindow, 1000000);
  contextWindow = 512000;
  notify("01a04445-8d03-7243-a4d3-181180bb6270");
  assert.equal(JSON.parse(storage.get("codex-control-console.turbo-turn-receipts.v1")).at(-1).contextWindow, 512000);
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: true, accessMode: "full-access", modelEfforts: [{ model: "gpt-6-astra", effort: "ultra" }] }), context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(JSON.parse(JSON.stringify(applied.at(-1))), { id: threadId, changes: { model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default", contextWindow: 512000, permissionProfile: ":workspace" } });
  assert.equal(JSON.parse(storage.get("codex-control-console.turbo-setting-leases.v1")).length, 0);
  notify("01a04445-8d03-7243-a4d3-181180bb6271");
  assert.equal(JSON.parse(storage.get("codex-control-console.turbo-turn-receipts.v1")).length, 3);
});

test("an in-flight verification cannot certify settings for a newer Turbo policy", async () => {
  let native = { model: "gpt-5.6-sol", reasoningEffort: "medium", serviceTier: "default" };
  let releaseApply;
  let markStarted;
  const applying = new Promise((resolve) => { releaseApply = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const policy = { enabled: true, active: true, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: false, accessMode: "preserve", efforts: new Map() };
  const window = {
    electronBridge: Object.freeze({ sendMessageFromView() {} }),
    __codexControlConsoleGetContextWindow: () => 512000,
    async __codexControlConsoleApplyThreadSettings(id, changes) { native = { ...native, ...changes }; markStarted(); await applying; }
  };
  const context = vm.createContext({ window, policy, localStorage: { getItem: () => null, setItem() {} }, resumeContext: async () => native });
  vm.runInContext(buildNativeTurboEnforcementSource() + "\nglobalThis.api = { applyTurboLease, verifiedTurboTurnSettings };", context);
  const apply = context.api.applyTurboLease(threadId);
  await started;
  policy.model = "gpt-5.6-luna";
  releaseApply(); await apply;
  assert.equal(context.api.verifiedTurboTurnSettings(threadId), null);
  await context.api.applyTurboLease(threadId);
  assert.equal(context.api.verifiedTurboTurnSettings(threadId).model, "gpt-5.6-luna");
});
