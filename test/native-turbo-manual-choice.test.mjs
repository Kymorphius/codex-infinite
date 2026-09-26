import test from "node:test";
import assert from "node:assert/strict";
import { installNativeTurboManualChoice } from "../src/native-turbo-manual-choice.mjs";

const a = "01a04445-8d03-7243-a4d3-181180bb626d";
const b = "01a04445-8d03-7243-a4d3-181180bb626e";

function runtime({ shared = new Map(), id = a, clock = () => 100, enabled = true } = {}) {
  let threadId = id, model = "gpt-5.6-sol", effort = "medium", optionModel = null, turboEnabled = enabled;
  const documentListeners = new Map(), windowListeners = new Map();
  const trigger = {
    getAttribute(name) { return name === "data-selected-reasoning-effort" ? effort : null; },
    querySelectorAll() { return [{ textContent: model === "gpt-6-astra" ? "GPT-6 Astra" : "GPT-5.6 Sol", closest: () => null }]; }
  };
  const documentRef = {
    body: {}, querySelector(selector) { return selector.includes("data-composer-navigation-target") ? trigger : null; },
    addEventListener(type, fn) { const list = documentListeners.get(type) || []; list.push(fn); documentListeners.set(type, list); },
    removeEventListener(type, fn) { documentListeners.set(type, (documentListeners.get(type) || []).filter((item) => item !== fn)); }
  };
  const hostWindow = {
    setTimeout, clearTimeout, queueMicrotask,
    addEventListener(type, fn) { const list = windowListeners.get(type) || []; list.push(fn); windowListeners.set(type, list); },
    removeEventListener(type, fn) { windowListeners.set(type, (windowListeners.get(type) || []).filter((item) => item !== fn)); }
  };
  const storage = { getItem: (key) => shared.get(key) || null, setItem: (key, value) => shared.set(key, String(value)) };
  let changes = 0;
  const tracker = installNativeTurboManualChoice({ hostWindow, documentRef, storage, readThreadId: () => threadId, isEnabled: () => turboEnabled, onChange: () => { changes += 1; }, now: clock });
  const node = (kind) => ({ closest(selector) {
    if (kind === "reasoning" && selector.includes("composer-navigation-target")) return this;
    if (kind === "toggle" && selector.includes("model-picker-view-toggle")) return this;
    if (kind === "model" && selector.includes("menuitemradio")) return this;
    if (kind === "slider" && selector.includes("reasoning-slider")) return this;
    if (kind === "send" && selector === "button") return this;
    if (kind === "editor" && selector.includes("contenteditable")) return this;
    if (kind === "sidebar" && selector.includes("data-app-action-sidebar-thread-id")) return this;
    return null;
  }, getAttribute(name) { return kind === "send" && name === "aria-label" ? "Send" : null; }, textContent: kind === "model" ? (optionModel || model) : "" });
  function emit(type, kind, extra = {}) { for (const fn of documentListeners.get(type) || []) fn({ type, target: node(kind), isTrusted: true, ...extra }); }
  function message(data) { for (const fn of windowListeners.get("message") || []) fn({ data }); }
  return { tracker, emit, message, storage, shared, storageEvent(event) { for (const fn of windowListeners.get('storage') || []) fn(event); }, get changes() { return changes; }, setId: (value) => { threadId = value; }, setModel: (value) => { model = value; }, setOptionModel: (value) => { optionModel = value; }, setEffort: (value) => { effort = value; }, setEnabled: (value) => { turboEnabled = value; } };
}

function modelChoice(r, value) { r.setOptionModel(value); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("click", "model"); r.setModel(value); r.tracker.refresh(); }
function effortChoice(r, value) { r.emit("keydown", "slider", { key: "ArrowRight" }); r.setEffort(value); r.tracker.refresh(); }

test("manual model-only and effort-only changes block only their own conversation", () => {
  const r = runtime(); r.tracker.refresh();
  modelChoice(r, "gpt-6-astra");
  assert.equal(r.tracker.blocks(a), true); assert.equal(r.tracker.blocks(b), false);
  const e = runtime({ shared: r.shared, id: b }); e.tracker.refresh();
  effortChoice(e, "high");
  assert.equal(e.tracker.blocks(b), true); assert.equal(e.tracker.blocks(a), true);
});

test("opening a picker, same values, synthetic input, other hosts, and unrelated notifications do not create an exception", () => {
  const r = runtime(); r.tracker.refresh();
  r.emit("click", "reasoning"); r.emit("click", "toggle");
  r.emit("click", "model"); r.tracker.refresh();
  assert.equal(r.tracker.has(a), false);
  r.emit("pointerdown", "slider", { isTrusted: false }); r.setEffort("high"); r.tracker.refresh();
  assert.equal(r.tracker.has(a), false);
  r.setOptionModel("gpt-6-astra"); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("click", "model");
  r.message({ type: "mcp-notification", hostId: "remote", method: "thread/settings/updated", params: { threadId: a, threadSettings: { effort: "high" } } });
  assert.equal(r.tracker.has(a), false);
  r.message({ type: "mcp-notification", hostId: "local", method: "message/updated", params: { threadId: a, threadSettings: { model: "gpt-6-astra" } } });
  assert.equal(r.tracker.has(a), false);
});

test("a matching local settings notification confirms a pending model selection and storage reload keeps records", () => {
  const r = runtime(); r.tracker.refresh(); r.setOptionModel("gpt-6-astra"); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("click", "model");
  r.message({
    type: "mcp-notification", hostId: "local",
    request: { method: "thread/settings/updated", params: { threadId: a, threadSettings: { collaborationMode: { settings: { model: "GPT-6 Astra" } } } } }
  });
  assert.equal(r.tracker.blocks(a), true);
  const reloaded = runtime({ shared: r.shared }); assert.equal(reloaded.tracker.blocks(a), true);
  reloaded.setId(b); reloaded.tracker.refresh(); assert.equal(reloaded.tracker.blocks(b), false);
});

test("a confirmed draft only migrates after its real send, and navigation drops an unsubmitted draft", () => {
  const r = runtime({ id: null }); r.tracker.refresh(); effortChoice(r, "high");
  assert.equal(r.tracker.blocks(null), true); r.emit("click", "sidebar");
  assert.equal(r.tracker.blocks(null), false); r.setId(a); r.tracker.refresh(); assert.equal(r.tracker.blocks(a), false);
  r.setId(null); r.setEffort("medium"); r.tracker.refresh(); effortChoice(r, "high");
  r.emit("click", "send"); r.setId(a); r.tracker.refresh();
  assert.equal(r.tracker.blocks(a), true); assert.equal(r.tracker.blocks(null), false);
});

test("a pending intent expires after five seconds and cannot be confirmed later", () => {
  let time = 0; const r = runtime({ clock: () => time }); r.tracker.refresh();
  r.emit("keydown", "slider", { key: "ArrowRight" }); time = 5001; r.setEffort("high"); r.tracker.refresh();
  assert.equal(r.tracker.has(a), false);
});

test('nested model-option targets use the full option label and closed pickers do not arm other radios', () => {
  for (const type of ['click','keydown']) {
    const r = runtime(); r.tracker.refresh(); r.emit('click','reasoning'); r.emit('click','toggle');
    const option = { textContent:'GPT-6 Astra' };
    const child = { textContent:'',closest:selector => selector === '[role="menuitemradio"]' ? option : null };
    r.emit(type,'model',{ key:'Enter',target:child });
    assert.equal(r.tracker.blocks(a),true);
    r.setModel('gpt-6-astra'); r.tracker.refresh();
    assert.equal(r.tracker.has(a),true); r.tracker.cleanup();
  }
  for (const [type, kind, extra] of [['click','outside',{}],['keydown','model',{ key:'Escape' }]]) {
    const r = runtime(); r.tracker.refresh(); r.emit('click','reasoning'); r.emit('click','toggle');
    r.emit(type,kind,extra); r.emit('click','model');
    assert.equal(r.tracker.blocks(a),false); r.tracker.cleanup();
  }
});

test('concurrent window storage writes merge both confirmed exceptions without revoking either', () => {
  const r = runtime(); r.tracker.refresh(); effortChoice(r,'high');
  const key = 'codex-control-console.turbo-manual-choice.v1';
  const concurrent = JSON.stringify([{ threadId:b,at:200 }]);
  r.shared.set(key,concurrent); r.storageEvent({ key,newValue:concurrent });
  assert.equal(r.tracker.has(a),true); assert.equal(r.tracker.has(b),true);
  assert.deepEqual(JSON.parse(r.shared.get(key)).map(item => item.threadId).sort(),[a,b]);
  const combined = r.shared.get(key); r.storageEvent({ key,newValue:concurrent });
  assert.equal(r.shared.get(key),combined); r.tracker.cleanup();
});

test('a stale automatic model update cannot confirm a different pending manual selection', () => {
  const r = runtime(); r.tracker.refresh(); r.setOptionModel('gpt-6-astra');
  r.emit('click','reasoning'); r.emit('click','toggle'); r.emit('click','model');
  const notify = model => r.message({ type:'mcp-notification',hostId:'local',method:'thread/settings/updated',params:{ threadId:a,threadSettings:{ model } } });
  notify('gpt-6-luna'); assert.equal(r.tracker.has(a),false);
  notify('gpt-6-astra'); assert.equal(r.tracker.has(a),true); r.tracker.cleanup();
});

test("pending intent blocks immediately, survives a disabled policy, and navigation rejects late notifications", () => {
  const r = runtime(); r.tracker.refresh(); r.setOptionModel("gpt-6-astra"); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("click", "model");
  assert.equal(r.tracker.blocks(a), true); r.setEnabled(false); assert.equal(r.tracker.blocks(a), true);
  r.setId(b); r.tracker.refresh();
  r.message({ type: "mcp-notification", hostId: "local", method: "thread/settings/updated", params: { threadId: a, threadSettings: { model: "gpt-6-astra" } } });
  assert.equal(r.tracker.has(a), false); assert.equal(r.tracker.blocks(b), false);
});

test("two windows merge persisted exceptions, and collaboration settings outrank flat settings", () => {
  const shared = new Map(); const first = runtime({ shared, id: a }); const second = runtime({ shared, id: b });
  first.tracker.refresh(); second.tracker.refresh(); modelChoice(first, "gpt-6-astra"); effortChoice(second, "high");
  const reloaded = runtime({ shared, id: a }); assert.equal(reloaded.tracker.has(a), true); assert.equal(reloaded.tracker.has(b), true);
  const r = runtime(); r.tracker.refresh(); r.setOptionModel("gpt-6-astra"); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("click", "model");
  r.message({ type: "mcp-notification", hostId: "local", method: "thread/settings/updated", params: { threadId: a, threadSettings: { model: "gpt-6-astra", collaborationMode: { settings: { model: "gpt-5.6-sol" } } } } });
  assert.equal(r.tracker.has(a), false);
  r.message({ type: "mcp-notification", hostId: "local", method: "thread/settings/updated", params: { threadId: a, threadSettings: { collaborationMode: { settings: { model: "gpt-6-astra" } } } } });
  assert.equal(r.tracker.has(a), true);
});

test("same model and non-selecting model keys do not create a pending override", () => {
  const r = runtime(); r.tracker.refresh(); r.emit("click", "reasoning"); r.emit("click", "toggle"); r.emit("keydown", "model", { key: "ArrowDown" }); r.tracker.refresh();
  r.emit("click", "model"); r.tracker.refresh(); assert.equal(r.tracker.has(a), false); assert.equal(r.tracker.blocks(a), false);
});
