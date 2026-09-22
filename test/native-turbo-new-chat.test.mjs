import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildNativeTurboNewChatSource } from "../src/native-turbo-new-chat.mjs";

function createRuntime() {
  const effortOrder = ["low", "medium", "high", "xhigh", "max", "ultra"];
  let model = "gpt-5.6-sol";
  let effort = "medium";
  let menuOpen = false;
  let modelListOpen = false;
  let fast = false;
  let sends = 0;
  const listeners = new Map();
  const trigger = {
    click() { menuOpen = !menuOpen; modelListOpen = false; },
    getAttribute(name) { return name === "data-selected-reasoning-effort" ? effort : null; },
    querySelectorAll() { return [{ textContent: model === "gpt-6-astra" ? "GPT-6 Astra" : "GPT-5.6 Sol" }]; }
  };
  const slider = {
    focus() {},
    dispatchEvent(event) {
      const index = effortOrder.indexOf(effort);
      effort = effortOrder[Math.max(0, Math.min(effortOrder.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))];
      return true;
    }
  };
  const toggle = { click() { modelListOpen = true; } };
  const astra = { textContent: "GPT-6 Astra", click() { model = "gpt-6-astra"; menuOpen = false; modelListOpen = false; } };
  const sol = { textContent: "GPT-5.6 Sol", click() { model = "gpt-5.6-sol"; menuOpen = false; modelListOpen = false; } };
  const fastToggle = {
    getAttribute(name) { return name === "aria-checked" ? String(fast) : null; },
    click() { fast = true; }
  };
  const send = { disabled: false, getAttribute(name) { return name === "aria-label" ? "发送" : null; }, click() { sends += 1; } };
  const document = {
    body: { click() { menuOpen = false; } },
    querySelector(selector) {
      if (selector === 'button[data-composer-navigation-target="reasoning"]') return trigger;
      if (selector.includes('[data-reasoning-slider]')) return menuOpen && !modelListOpen ? slider : null;
      if (selector.includes("data-model-picker-view-toggle")) return menuOpen && !modelListOpen ? toggle : null;
      if (selector.includes("menuitemcheckbox")) return menuOpen && !modelListOpen ? fastToggle : null;
      return null;
    },
    querySelectorAll(selector) { return selector === '[role="menuitemradio"]' && modelListOpen ? [astra, sol] : selector === "button" ? [send] : []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const policy = {
    enabled: true, active: true, model: "gpt-6-astra", reasoningEffort: "ultra", fast: true,
    efforts: new Map([["gpt-6-astra", "ultra"], ["gpt-5.6-sol", "ultra"]]),
    modelOptions: [{ id: "gpt-6-astra", efforts: effortOrder }]
  };
  const window = {};
  const context = vm.createContext({
    window, document, policy, selectedTurboThreadId: () => null,
    turboLabel: (id) => id === "gpt-6-astra" ? "GPT-6 Astra" : "GPT-5.6 Sol",
    decorateReasoningControl() {}, setTimeout, queueMicrotask, Date, Map, Array, String,
    KeyboardEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  });
  vm.runInContext(`${buildNativeTurboNewChatSource()}\nglobalThis.api = { syncTurboNewChatPreset, turboNewChatIsReady, blockUnpreparedTurboNewChat };`, context);
  return { context, window, listeners, values: () => ({ model, effort, fast, sends }) };
}

test("Turbo prepares a new chat before its first native send", async () => {
  const runtime = createRuntime();
  assert.equal(await runtime.context.api.syncTurboNewChatPreset(), true);
  assert.deepEqual(runtime.values(), { model: "gpt-6-astra", effort: "ultra", fast: true, sends: 0 });
  assert.equal(runtime.context.api.turboNewChatIsReady(), true);
  assert.equal(runtime.window.__codexControlConsoleLastTurboEnforcement.mode, "new-chat-preset");
});

test("an immediate new-chat send waits for the shared preset and then replays once", async () => {
  const runtime = createRuntime();
  const preparing = runtime.context.api.syncTurboNewChatPreset();
  let prevented = 0;
  runtime.context.api.blockUnpreparedTurboNewChat({
    type: "click", target: { closest() { return { getAttribute: () => "发送", textContent: "" }; } },
    preventDefault() { prevented += 1; }, stopImmediatePropagation() {}
  });
  assert.equal(await preparing, true);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(prevented, 1);
  assert.equal(runtime.values().sends, 1);
});
