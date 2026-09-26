import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  applyNativeTurboAction,
  buildNativeTurboInjectionScript,
  buildNativeTurboSnapshotScript,
  normalizeTurboPolicy,
  NATIVE_TURBO_BINDING,
  parseNativeTurboAction
} from "../src/native-turbo-injection.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

test("native quota snapshots default to 10 percent and expose only bounded status metadata", () => {
  const defaults = normalizeTurboPolicy();
  assert.equal(defaults.autoDisableOnLowQuota, true); assert.equal(defaults.quotaRemainingThreshold, 10); assert.equal(defaults.quotaStatus, null);
  const supplied = { autoDisableOnLowQuota:false, quotaRemainingThreshold:0, quotaStatus:{
    state:"triggered", remainingPercent:9.5, thresholdPercent:10, lastCheckedAt:"2026-09-26T01:00:00.000Z",
    lastTriggeredAt:"2026-09-26T01:00:00.000Z", accountId:"private-account", token:"private-token"
  } };
  const snapshot = normalizeTurboPolicy(supplied);
  assert.equal(snapshot.autoDisableOnLowQuota, false); assert.equal(snapshot.quotaRemainingThreshold, 0);
  assert.deepEqual(snapshot.quotaStatus, { state:"triggered",remainingPercent:9.5,thresholdPercent:10,lastCheckedAt:"2026-09-26T01:00:00.000Z",lastTriggeredAt:"2026-09-26T01:00:00.000Z" });
  assert.doesNotMatch(buildNativeTurboSnapshotScript(supplied), /private-account|private-token/);
  for (const value of [-1, 101, 9.5, "10", null]) assert.equal(normalizeTurboPolicy({ quotaRemainingThreshold:value }).quotaRemainingThreshold, 10);
  assert.equal(normalizeTurboPolicy({ quotaRemainingThreshold:100 }).quotaRemainingThreshold, 100);
  assert.equal(normalizeTurboPolicy({ quotaStatus:{ state:"unexpected" } }).quotaStatus, null);
  assert.deepEqual(normalizeTurboPolicy({ quotaStatus:{ state:"unknown", remainingPercent:Infinity, thresholdPercent:-1, lastCheckedAt:"invalid", lastTriggeredAt:"x".repeat(1000) } }).quotaStatus, { state:"unknown",remainingPercent:null,thresholdPercent:10 });
});

function runtime({ respondToResume = true } = {}) {
  const sent = [];
  const listeners = new Map();
  const window = {
    electronBridge: { sendMessageFromView(message) {
      sent.push(message);
      if (respondToResume && message?.request?.method === "thread/resume") queueMicrotask(() => {
        for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-response", hostId: "local", message: { id: message.request.id, result: {} } } });
      });
      return Promise.resolve();
    } },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const document = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const storage = new Map();
  const localStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, String(value)); } };
  const context = { window, document, localStorage, setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout, queueMicrotask, Math, Date, Map, Set, JSON };
  vm.runInNewContext(buildNativeTurboInjectionScript(), context);
  const respond = (id, result = {}, error) => { for (const listener of listeners.get("message") || []) listener({ data: { type: "mcp-response", hostId: "local", message: { id, result, error } } }); };
  return { context, window, sent, respond, storage };
}

test("native runtime receives quota settings and refreshes trigger status without account data", () => {
  const { context, window } = runtime();
  assert.equal(window.__codexControlConsoleTurboVersion, "2026-09-26.device-scope-retired1");
  const snapshot = vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled:false,autoDisableOnLowQuota:true,quotaRemainingThreshold:25,quotaStatus:{ state:"triggered",remainingPercent:20,thresholdPercent:25,accountId:"private" } }), context);
  assert.equal(snapshot.autoDisableOnLowQuota, true); assert.equal(snapshot.quotaRemainingThreshold, 25);
  assert.equal(snapshot.quotaStatus.state, "triggered"); assert.equal(snapshot.quotaStatus.remainingPercent, 20);
  assert.equal(snapshot.quotaStatus.accountId, undefined);
  const direct = window.__codexControlConsoleSetTurboPolicy({ autoDisableOnLowQuota:false,quotaRemainingThreshold:100,quotaStatus:{ state:"healthy",remainingPercent:101,thresholdPercent:100,accountId:"private" } });
  assert.equal(direct.autoDisableOnLowQuota, false); assert.equal(direct.quotaRemainingThreshold, 100);
  assert.equal(direct.quotaStatus.remainingPercent, null); assert.equal(direct.quotaStatus.accountId, undefined);
});

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

test("renderer routing cannot delay or replace the Turbo native send", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({
    enabled: true, model: "gpt-5.6-luna", reasoningEffort: "high", fast: true,
    accessMode: "read-only", modelEfforts: [{ model: "gpt-5.6-luna", effort: "high" }]
  }), context);
  let rendererRoutingCalls = 0;
  window.__codexControlConsoleRouteNativeTurn = () => { rendererRoutingCalls += 1; return new Promise(() => {}); };
  await window.electronBridge.sendMessageFromView({ type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", input: [] } } });
  assert.equal(rendererRoutingCalls, 0);
  assert.equal(sent[0].request.params.model, "gpt-5.6-luna");
  assert.equal(sent[0].request.params.effort, "high");
  assert.equal(sent[0].request.params.permissions, ":read-only");
  assert.equal(sent[0].request.params.serviceTierForTurn, "priority");
});

test("unprepared million-context send waits for enhancement and never falls back", async () => {
  const { context, window, sent, respond } = runtime({ respondToResume: false });
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, millionContext: true, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  const sending = window.electronBridge.sendMessageFromView({ type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", input: [] } } });
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.deepEqual(sent.map((item) => item.request.method), ["thread/resume"]);
  assert.equal(typeof sending?.then, "function");
  respond(sent[0].request.id);
  await sending;
  assert.deepEqual(sent.map((item) => item.request.method), ["thread/resume", "turn/start"]);
});

test("Turbo leaves an explicitly inactive snapshot untouched", async () => {
  const { context, window, sent } = runtime();
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, active: false, fast: true, modelEfforts: [{ model: "gpt-5.6-sol", effort: "ultra" }] }), context);
  const request = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "low", input: [] } } };
  await window.electronBridge.sendMessageFromView(request);
  assert.equal(sent[0], request);
});

test("Turbo annotation freezes dispatched settings and requires successful exact-turn acceptance", async () => {
  const { context, window, respond, storage } = runtime();
  const turnId = "01a04445-8d03-7243-a4d3-181180bb626e";
  const policy = { enabled: true, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true, millionContext: true };
  vm.runInNewContext(buildNativeTurboSnapshotScript(policy), context);
  await window.electronBridge.sendMessageFromView({ type: "mcp-request", hostId: "local", request: { id: "turn-receipt", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium", input: [{ text: "never store this" }] } } });
  assert.equal(storage.has("codex-control-console.turbo-turn-receipts.v1"), false);
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: false }), context);
  respond("unrelated", { turn: { id: turnId } });
  assert.equal(storage.has("codex-control-console.turbo-turn-receipts.v1"), false);
  respond("turn-receipt", { turn: { id: turnId } });
  const receipts = JSON.parse(storage.get("codex-control-console.turbo-turn-receipts.v1"));
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].model, "gpt-6-astra");
  assert.equal(receipts[0].effort, "ultra");
  assert.equal(receipts[0].serviceTier, "priority");
  assert.equal(receipts[0].contextWindow, 1000000);
  assert.equal(receipts[0].turnId, turnId);
  assert.equal(JSON.stringify(receipts).includes("never store this"), false);
});

test("failed Turbo context preparation produces neither a send nor a receipt", async () => {
  const { context, window, sent, respond, storage } = runtime({ respondToResume: false });
  vm.runInNewContext(buildNativeTurboSnapshotScript({ enabled: true, model: "gpt-6-astra", reasoningEffort: "ultra", millionContext: true }), context);
  const sending = window.electronBridge.sendMessageFromView({ type: "mcp-request", hostId: "local", request: { id: "failed", method: "turn/start", params: { threadId, model: "gpt-5.6-sol", effort: "medium" } } });
  const rejected = assert.rejects(sending, /context failed/);
  respond(sent[0].request.id, {}, { message: "context failed" });
  await rejected;
  assert.equal(sent.length, 1);
  respond("failed", { turn: { id: "01a04445-8d03-7243-a4d3-181180bb626e" } });
  assert.equal(storage.has("codex-control-console.turbo-turn-receipts.v1"), false);
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
  assert.match(source, /const TURBO_PREPARE_TIMEOUT_MS = 8000/);
  assert.match(source, /timeoutMs = TURBO_PREPARE_TIMEOUT_MS/);
  assert.match(source, /preparation \? preparation\.then\(dispatch\) : dispatch\(\)/);
  assert.doesNotMatch(source, /await window\.__codexControlConsoleRouteNativeTurn/);
  assert.match(source, /data-codex-control-console-native-turbo/);
  assert.match(source, /data-codex-control-console-turbo-effective/);
  assert.equal(source.match(/data-codex-control-console-native-turbo-settings/g)?.length, 1);
  assert.doesNotMatch(source, /setAttribute\('data-codex-control-console-native-turbo-settings'/);
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /openSettings\(button\)/);
  assert.match(source, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
  assert.match(source, /button\.setAttribute\('aria-label', active \? 'Turbo 模式已开启' : 'Turbo 模式已关闭'\)/);
  assert.match(source, /button\.replaceChildren\(icon\)/);
  assert.match(source, /百万上下文/);
  assert.match(source, /data-composer-navigation-target="reasoning"/);
  assert.match(source, /Fast/);
  assert.match(source, /自动关闭全局路由/);
  assert.match(source, /data-codex-control-console-turbo-switch-track/);
  assert.match(source, /translateX\(14px\)/);
  assert.match(source, /autoDisableGlobalRouting:autoDisableGlobalRouting\.checked/);
  assert.doesNotMatch(source, /const badge = document\.createElement\('small'\).*textContent = '1M'/);
  assert.match(source, /button\[aria-label="搜索"\]/);
  assert.match(source, /data-codex-control-console-interactive-header/);
  assert.match(source, /-webkit-app-region', 'drag', 'important/);
  assert.match(source, /-webkit-app-region', 'no-drag', 'important/);
  assert.match(source, new RegExp(NATIVE_TURBO_BINDING));
  assert.deepEqual(parseNativeTurboAction('{"enabled":true}'), { enabled: true });
  assert.deepEqual(parseNativeTurboAction('{"millionContext":true}'), { millionContext: true });
  assert.deepEqual(parseNativeTurboAction('{"autoDisableGlobalRouting":true}'), { autoDisableGlobalRouting: true });
  assert.equal(parseNativeTurboAction('{"autoDisableGlobalRouting":"yes"}'), null);
  assert.deepEqual(parseNativeTurboAction('{"model":"gpt-5.6-luna","reasoningEffort":"max","fast":false,"accessMode":"workspace","deviceIds":["mac-air"]}'), { model: "gpt-5.6-luna", reasoningEffort: "max", fast: false, accessMode: "workspace", deviceIds: ["mac-air"] });
  assert.equal(parseNativeTurboAction('{"enabled":true,"extra":1}'), null);
  let received = null;
  const result = await applyNativeTurboAction('{"enabled":false}', { async update(change) { received = change; return change; } });
  assert.deepEqual(received, { enabled: false });
  assert.deepEqual(result, { enabled: false });
});
