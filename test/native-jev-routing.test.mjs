import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  buildNativeJevRoutingInjectionScript,
  buildNativeJevRoutingSnapshotScript,
  formatNativeJevModelChange,
  formatNativeJevTurnChoice,
  handleNativeJevRoutingRequest,
  NATIVE_JEV_ROUTING_BINDING,
  normalizeNativeJevRoutingSnapshot,
  parseNativeJevRoutingRequest,
  releaseNativeJevSend,
  selectNativeJevRoutingTurn
} from "../src/native-jev-routing.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";

function runtime({ classification } = {}) {
  const document = { querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {} };
  const listeners = new Map();
  const window = {
    __codexControlConsoleMutationSubscribers: new Set(),
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
  const context = { window, document, setInterval() { throw new Error("interval refresh must not be installed"); }, clearInterval() {}, setTimeout, clearTimeout, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {}, queueMicrotask, Date, Map, Set, JSON };
  vm.runInNewContext(buildNativeJevRoutingInjectionScript(), context);
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({
    available: true,
    config: { enabled: true, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }
  }), context);
  return { context, window };
}

function composerRuntime({ delayedSendRecovery = false, modelChangeNotice = false } = {}) {
  const thread = { getAttribute(name) { return name === "data-above-composer-conversation-id" ? threadId : null; } };
  const editor = { innerText: "Route this composer turn", closest(selector) { return selector.includes("data-codex-composer") ? this : null; } };
  const documentListeners = new Map();
  let sends = 0;
  let sendVisible = true;
  let turnVisible = false;
  let noticeVisible = false;
  const noticeText = { nodeType: 3, nodeValue: "模型已从 " };
  const noticeTail = [
    { nodeType: 3, nodeValue: "自定义" },
    { nodeType: 3, nodeValue: " 更改为 " },
    { nodeType: 3, nodeValue: "自定义" },
    { nodeType: 3, nodeValue: "。" }
  ];
  const notice = {
    nodeType: 1,
    childNodes: [{ nodeType: 1 }, noticeText, ...noticeTail, { nodeType: 1 }],
    hasAttribute(name) { return this.marker === name; },
    matches(selector) { return selector === "span"; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    setAttribute(name) { this.marker = name; }
  };
  noticeText.parentElement = notice;
  for (const text of noticeTail) text.parentElement = notice;
  let badge = null;
  const bubbleHost = {};
  const bubble = { parentElement: bubbleHost, after(node) { badge = node; } };
  const turn = {
    nodeType: 1,
    getAttribute(name) { return name === "data-content-search-turn-key" ? "01a0bf10-1497-7263-a1ca-4ea079c001de" : null; },
    matches(selector) { return selector.includes("[data-content-search-turn-key]"); },
    querySelector(selector) {
      if (selector === "[data-user-message-bubble]") return bubble;
      if (selector === "[data-codex-control-console-jev-turn]") return badge;
      return null;
    },
    querySelectorAll(selector) { return selector === "span" && noticeVisible ? [notice] : []; }
  };
  const send = {
    disabled: false,
    closest(selector) { return selector.includes("aria-label") ? this : null; },
    click() { sends += 1; turnVisible = true; documentListeners.get("click")?.({ target: this, preventDefault() {}, stopImmediatePropagation() {} }); }
  };
  const document = {
    querySelector(selector) {
      if (selector === "[data-above-composer-conversation-id]") return thread;
      if (selector.includes("data-codex-composer")) return editor;
      if (selector.includes('button[aria-label="发送"]')) return sendVisible ? send : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-content-search-turn-key]") return turnVisible ? [turn] : [];
      if (selector === "span") return noticeVisible ? [notice] : [];
      return [];
    },
    createElement() { return { setAttribute() {}, style: {}, remove() {} }; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type) { documentListeners.delete(type); }
  };
  const applied = [];
  const window = {
    __codexControlConsoleMutationSubscribers: new Set(),
    electronBridge: Object.freeze({ sendMessageFromView() { throw new Error("frozen bridge must not be wrapped"); } }),
    async __codexControlConsoleApplyThreadSettings(id, changes) {
      applied.push({ id, changes });
      if (modelChangeNotice) noticeVisible = true;
      if (delayedSendRecovery) { sendVisible = false; setTimeout(() => { sendVisible = true; }, 100); }
      return { applied: true };
    },
    addEventListener() {}
  };
  window[NATIVE_JEV_ROUTING_BINDING] = (payload) => {
    const request = JSON.parse(payload);
    queueMicrotask(() => window.__codexControlConsoleResolveJevRouting({ id: request.id, kind: request.kind, ok: true, classification: { tier: "complex", model: "gpt-5.6-sol", effort: "high", confidence: 0.9, fallback: false } }));
  };
  const context = { window, document, setInterval() { throw new Error("interval refresh must not be installed"); }, clearInterval() {}, setTimeout, clearTimeout, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {}, queueMicrotask, Date, Map, Set, JSON, Object, Number, String, Array, RegExp };
  vm.runInNewContext(buildNativeJevRoutingInjectionScript(), context);
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({ available: true, config: { enabled: true, fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } } }), context);
  const mutate = (records) => Array.from(window.__codexControlConsoleMutationSubscribers)[0]?.(records);
  return { applied, badge: () => badge, context, documentListeners, editor, mutate, notice, noticeTail, noticeText, send, sends: () => sends, turn, window };
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
  assert.deepEqual(normalizeNativeJevRoutingSnapshot({}), { enabled: false, available: false, transportMode: "router", fallbackTier: "everyday", mappings: {}, threadOverrides: {}, receipts: [] });
  assert.deepEqual(normalizeNativeJevRoutingSnapshot({ available: true, config: { enabled: false, fallbackTier: "deep", mappings: {
    deep: { model: "gpt-5.6-sol", effort: "xhigh" }, bad: { model: "unknown", effort: "high" }
  }, transportMode: "native" }, threadOverrides: { [threadId.toUpperCase()]: false, invalid: true } }), { enabled: false, available: true, transportMode: "native", fallbackTier: "deep", mappings: { deep: { model: "gpt-5.6-sol", effort: "xhigh" } }, threadOverrides: { [threadId]: false }, receipts: [] });
});

test("turn choice labels and pending-turn matching stay bounded and deterministic", () => {
  const first = "01a0bf0e-f99d-7712-ada7-4a676030e96b", second = "01a0bf10-1497-7263-a1ca-4ea079c001de";
  assert.equal(formatNativeJevTurnChoice({ tier: "complex", model: "gpt-5.6-sol", effort: "medium" }), "Jev · 复杂 · GPT-5.6 Sol · medium");
  assert.equal(formatNativeJevTurnChoice({ tier: "deep", model: "gpt-5.6-sol", effort: "high", lowConfidence: true }), "Jev · 深度 · GPT-5.6 Sol · high · 低置信度");
  assert.equal(formatNativeJevTurnChoice({ tier: "everyday", model: "gpt-5.6-terra", effort: "low", fallback: true }), "Jev · 日常 · GPT-5.6 Terra · low · 兜底");
  assert.equal(formatNativeJevModelChange({ model: "gpt-5.6-sol", effort: "high", confidence: 0.9 }), "模型已设置为 GPT-5.6 Sol，推理强度 high，置信度 0.90。");
  assert.equal(formatNativeJevModelChange({ model: "gpt-5.6-sol", effort: "high", confidence: 0.18, lowConfidence: true }), "模型已设置为 GPT-5.6 Sol，推理强度 high，置信度 0.18（低置信度）。");
  assert.equal(formatNativeJevModelChange({ model: "gpt-5.6-terra", effort: "medium", confidence: 0.18, fallback: true }), "模型已设置为 GPT-5.6 Terra，推理强度 medium，置信度 0.18（兜底）。");
  const candidates = [{ id: first, userText: "same" }, { id: second, userText: "same" }];
  assert.equal(selectNativeJevRoutingTurn(candidates, "same", [first], []), second);
  assert.equal(selectNativeJevRoutingTurn(candidates, "same", [first, second], []), null);
  assert.equal(selectNativeJevRoutingTurn(candidates, "same", [first, second], [], true), second);
  assert.equal(selectNativeJevRoutingTurn(candidates, "same", [first], [second]), null);
});

test("native send release waits for availability and fires once", async () => {
  let clock = 0, attempts = 0, releases = 0;
  const sent = await releaseNativeJevSend(
    () => (++attempts < 3 ? null : { disabled: false }),
    () => { releases += 1; },
    async (ms) => { clock += ms; },
    () => clock,
  );
  assert.equal(sent, true);
  assert.equal(attempts, 3);
  assert.equal(releases, 1);
});

test("native turn/start requests are no longer changed or delayed in the renderer", async () => {
  const { window } = runtime();
  const original = { type: "mcp-request", hostId: "local", request: { id: "turn", method: "turn/start", params: {
    threadId, model: "gpt-5.6-luna", effort: "low", input: [{ type: "text", text: "Refactor the shared runtime safely" }]
  } } };
  const routed = await window.__codexControlConsoleRouteNativeTurn(original);
  assert.equal(routed, original);
});

test("composer input is not captured and native sending remains authoritative", () => {
  const harness = composerRuntime();
  assert.equal(harness.documentListeners.has("keydown"), false);
  assert.equal(harness.documentListeners.has("click"), false);
  assert.equal(harness.applied.length, 0);
  assert.equal(harness.sends(), 0);
  assert.equal(harness.window.__codexControlConsoleJevRoutingDiagnostics.refreshMode, "shared-mutation-events");
});

test("an exact router receipt decorates its matching native turn", () => {
  const harness = composerRuntime();
  harness.send.click();
  vm.runInNewContext(buildNativeJevRoutingSnapshotScript({ available: true, config: { enabled: true, transportMode: "router", fallbackTier: "everyday", mappings: { everyday: { model: "gpt-5.6-terra", effort: "medium" } } }, receipts: [{ threadId, turnId: "01a0bf10-1497-7263-a1ca-4ea079c001de", tier: "complex", model: "gpt-5.6-sol", effort: "high", confidence: 0.9, fallback: false, lowConfidence: false, reason: "actual router choice" }] }), harness.context);
  assert.equal(harness.badge()?.textContent, "Jev · 复杂 · GPT-5.6 Sol · high");
  assert.match(harness.badge()?.title || "", /置信度 0\.90/);
});

test("native Jev source installs the visible default-on switch", () => {
  const source = buildNativeJevRoutingInjectionScript();
  assert.match(source, /data-codex-control-console-native-jev/);
  assert.match(source, /data-codex-control-console-native-jev-current/);
  assert.match(source, /data-codex-control-console-native-jev-choice/);
  assert.match(source, /data-codex-control-console-jev-native-model-disabled/);
  assert.match(source, /data-composer-navigation-target="permissions"/);
  assert.match(source, /data-composer-navigation-target="reasoning"/);
  assert.match(source, /新建聊天继承全局 Jev 路由/);
  assert.match(source, /selectedThreadId \? await request\('set-thread-enabled'/);
  assert.match(source, /if \(!composerHost\) \{ current\?\.remove\(\); choice\?\.remove\(\); return; \}/);
  assert.match(source, /button\.textContent = 'Jev';/);
  assert.doesNotMatch(source, /Jev 全局/);
  assert.match(source, /'Jev 原生' : 'Jev 路由'/);
  assert.match(source, /Jev 当前模型和推理强度/);
  assert.doesNotMatch(source, /Jev 自动 ·/);
  assert.match(source, /data-codex-control-console-jev-turn/);
  assert.match(source, /shared-mutation-events/);
  assert.doesNotMatch(source, /setInterval\(installButtons/);
  assert.match(source, /Jev 自动分流已开启/);
  assert.match(source, /addEventListener\('pointerup'/);
  assert.match(source, /pointer-events:auto!important/);
  assert.match(source, /ignoreClickUntil/);
  assert.match(source, /flex:0 0 82px/);
  assert.doesNotMatch(source, /flex:0 0 196px/);
  assert.match(source, /data-codex-control-console-jev-native-model-effective/);
  assert.match(source, /Jev 当前模型和推理强度/);
  assert.match(source, /color:#62bd84/);
  assert.match(source, /font:inherit/);
  assert.doesNotMatch(source, /style\.setProperty\('border-color'/);
  assert.match(source, /medium: '中'/);
  assert.match(source, /ultra: 'Ultra'/);
  assert.match(source, /child\.tagName === 'svg'/);
  assert.match(source, /inset:0 20px 0 0/);
  assert.match(source, /__codexControlConsoleRouteNativeTurn/);
  assert.doesNotMatch(source, /document\.addEventListener\('keydown', interceptComposerKeydown/);
  assert.doesNotMatch(source, /document\.addEventListener\('click', interceptComposerClick/);
  assert.doesNotMatch(selectNativeJevRoutingTurn.toString(), /THREAD_ID_PATTERN/);
  assert.match(source, new RegExp(NATIVE_JEV_ROUTING_BINDING));
});
