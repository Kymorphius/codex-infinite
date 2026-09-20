import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  buildNativeJevRoutingInjectionScript,
  buildNativeJevRoutingSnapshotScript,
  handleNativeJevRoutingRequest,
  NATIVE_JEV_ROUTING_BINDING,
  normalizeNativeJevRoutingSnapshot,
  parseNativeJevRoutingRequest
} from "../src/native-jev-routing.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

function runtime({ classification } = {}) {
  const document = { querySelector() { return null; } };
  const listeners = new Map();
  const window = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); }
  };
  window[NATIVE_JEV_ROUTING_BINDING] = (payload) => {
    const request = JSON.parse(payload);
    queueMicrotask(() => window.__codexControlConsoleResolveJevRouting({
      id: request.id,
      kind: request.kind,
      ok: true,
      ...(request.kind === "classify"
        ? { classification: classification || { tier: "deep", model: "gpt-5.6-sol", effort: "xhigh", confidence: 0.91, fallback: false } }
        : { snapshot: { available: true, config: { enabled: request.enabled, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }, threadOverrides: request.kind === "set-thread-enabled" ? { [request.threadId]: request.enabled } : {} } })
    }));
  };
  const context = { window, document, setInterval() { return 1; }, clearInterval() {}, setTimeout, clearTimeout, queueMicrotask, Date, Map, JSON };
  vm.runInNewContext(buildNativeJevRoutingInjectionScript(), context);
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({
    available: true,
    config: { enabled: true, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }
  }), context);
  return { context, window };
}

test("native Jev binding accepts only bounded classify and toggle requests", async () => {
  assert.deepEqual(parseNativeJevRoutingRequest('{"id":"one","kind":"set-enabled","enabled":false}'), { id: "one", kind: "set-enabled", enabled: false });
  assert.deepEqual(parseNativeJevRoutingRequest(`{"id":"thread","kind":"set-thread-enabled","threadId":"${threadId}","enabled":false}`), { id: "thread", kind: "set-thread-enabled", threadId, enabled: false });
  assert.deepEqual(parseNativeJevRoutingRequest('{"id":"two","kind":"classify","prompt":" fix it "}'), { id: "two", kind: "classify", prompt: "fix it" });
  assert.equal(parseNativeJevRoutingRequest('{"id":"two","kind":"classify","prompt":""}'), null);
  assert.equal(parseNativeJevRoutingRequest('{"id":"two","kind":"other"}'), null);

  const calls = [];
  const service = {
    async setEnabled(enabled) { calls.push(["enabled", enabled]); return { enabled }; },
    async setThreadEnabled(id, enabled) { calls.push(["thread", id, enabled]); return { config: { enabled: true }, threadOverrides: { [id]: enabled } }; },
    async snapshot() { return { config: { enabled: false }, threadOverrides: {} }; },
    async classifyCurrent(prompt) { calls.push(["classify", prompt]); return { tier: "quick" }; }
  };
  assert.equal((await handleNativeJevRoutingRequest('{"id":"one","kind":"set-enabled","enabled":false}', service)).snapshot.config.enabled, false);
  assert.equal((await handleNativeJevRoutingRequest(`{"id":"thread","kind":"set-thread-enabled","threadId":"${threadId}","enabled":false}`, service)).snapshot.threadOverrides[threadId], false);
  assert.equal((await handleNativeJevRoutingRequest('{"id":"two","kind":"classify","prompt":"fix"}', service)).classification.tier, "quick");
  assert.deepEqual(calls, [["enabled", false], ["thread", threadId, false], ["classify", "fix"]]);
});

test("native Jev snapshot is bounded and enables only from stored configuration", () => {
  assert.deepEqual(normalizeNativeJevRoutingSnapshot({}), { enabled: false, available: false, fallbackTier: "everyday", mappings: {}, threadOverrides: {} });
  assert.deepEqual(normalizeNativeJevRoutingSnapshot({ available: true, config: { enabled: false, fallbackTier: "deep", mappings: {
    deep: { model: "gpt-5.6-sol", effort: "xhigh" }, bad: { model: "unknown", effort: "high" }
  } }, threadOverrides: { [threadId.toUpperCase()]: false, invalid: true } }), { enabled: false, available: true, fallbackTier: "deep", mappings: { deep: { model: "gpt-5.6-sol", effort: "xhigh" } }, threadOverrides: { [threadId]: false } });
});

test("every native turn is cloned and routed, including an existing conversation", async () => {
  const { window } = runtime();
  const original = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: {
    threadId, model: "gpt-5.6-luna", effort: "low", input: [{ type: "text", text: "Refactor the shared runtime safely" }]
  } } };
  const routed = await window.__codexControlConsoleRouteNativeTurn(original);
  assert.notEqual(routed, original);
  assert.equal(original.request.params.model, "gpt-5.6-luna");
  assert.equal(routed.request.params.model, "gpt-5.6-sol");
  assert.equal(routed.request.params.effort, "xhigh");
  assert.equal(window.__codexControlConsoleLastJevRouting.tier, "deep");
});

test("collaboration turns keep their instructions while Jev owns model and effort", async () => {
  const { window } = runtime({ classification: { tier: "critical", model: "gpt-6-astra", effort: "ultra", fallback: false } });
  const collaborationMode = { mode: "default", settings: { model: "gpt-5.6-luna", reasoning_effort: "low", developer_instructions: "keep" } };
  const routed = await window.__codexControlConsoleRouteNativeTurn({ type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, collaborationMode, input: [{ type: "text", text: "Audit a risky migration" }] } } });
  assert.equal(routed.request.params.collaborationMode.settings.model, "gpt-6-astra");
  assert.equal(routed.request.params.collaborationMode.settings.reasoning_effort, "ultra");
  assert.equal(routed.request.params.collaborationMode.settings.developer_instructions, "keep");
});

test("attachment-only turns use the configured fallback and disabling restores native requests", async () => {
  const { context, window } = runtime();
  const request = { type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, model: "gpt-5.6-luna", effort: "low", input: [{ type: "localImage", path: "/tmp/image.png" }] } } };
  const fallback = await window.__codexControlConsoleRouteNativeTurn(request);
  assert.equal(fallback.request.params.model, "gpt-5.6-terra");
  assert.equal(fallback.request.params.effort, "medium");
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({ config: { enabled: false, fallbackTier: "everyday", mappings: {} } }), context);
  assert.equal(await window.__codexControlConsoleRouteNativeTurn(request), request);
});

test("a current-conversation override wins over the global default", async () => {
  const { context, window } = runtime();
  const request = { type: "mcp-request", hostId: "local", request: { method: "turn/start", params: { threadId, model: "gpt-5.6-luna", effort: "low", input: [{ type: "text", text: "route this" }] } } };
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({ available: true, config: { enabled: true, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }, threadOverrides: { [threadId]: false } }), context);
  assert.equal(await window.__codexControlConsoleRouteNativeTurn(request), request);
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({ available: true, config: { enabled: false, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }, threadOverrides: { [threadId]: true } }), context);
  assert.equal((await window.__codexControlConsoleRouteNativeTurn(request)).request.params.model, "gpt-5.6-sol");
});

test("native Jev source installs the visible default-on switch", () => {
  const source = buildNativeJevRoutingInjectionScript();
  assert.match(source, /data-codex-control-console-native-jev/);
  assert.match(source, /data-codex-control-console-native-jev-current/);
  assert.match(source, /data-composer-navigation-target="permissions"/);
  assert.match(source, /Jev 全局/);
  assert.match(source, /Jev 自动分流已开启/);
  assert.match(source, /__codexControlConsoleRouteNativeTurn/);
  assert.match(source, new RegExp(NATIVE_JEV_ROUTING_BINDING));
});
