import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {
  JEV_ROUTE_MODELS, JEV_ROUTE_MODEL_EFFORTS, defaultJevRoutingConfig,
  normalizeJevRoutingConfig, supportsJevRoute
} from "../src/jev-routing-policy.mjs";
import { JevRoutingStore } from "../src/jev-routing-store.mjs";
import { normalizeJevRoutingReceipt } from "../src/jev-routing-service.mjs";
import { parseNativeJevRoutingRequest } from "../src/native-jev-routing-request.mjs";
import {
  formatNativeJevModelChange, formatNativeJevTurnChoice,
  normalizeNativeJevRoutingSnapshot
} from "../src/native-jev-routing-contract.mjs";
import { buildNativeJevRoutingPanelSource } from "../src/native-jev-routing-panel.mjs";
import { buildNativeJevRoutingInjectionScript } from "../src/native-jev-routing.mjs";
import { JEV_MODELS, JEV_MODEL_EFFORTS } from "../public/features/jev-routing/index.js";

const model = "gpt-6.1-sol";
const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];
const threadId = "11111111-1111-4111-8111-111111111111";
const turnId = "22222222-2222-4222-8222-222222222222";

function configFor(effort) {
  const defaults = defaultJevRoutingConfig();
  return {
    ...defaults, enabled: false, transportMode: "native", minConfidence: 0.82,
    fallbackTier: "deep", mappings: { ...defaults.mappings, complex: { model, effort } }
  };
}

test("GPT-6.1 Sol round-trips every native effort without changing other routing settings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "jev-gpt-6.1-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new JevRoutingStore({ filePath: path.join(directory, "routing.json") });
  for (const effort of efforts) {
    const config = configFor(effort);
    assert.equal(supportsJevRoute(model, effort), true);
    assert.deepEqual(normalizeJevRoutingConfig(config), config);
    assert.deepEqual(await store.write(config), config);
    assert.deepEqual(await store.read(), config);
    const request = { id: "save-sol61", kind: "set-mappings", mappings: config.mappings };
    assert.deepEqual(parseNativeJevRoutingRequest(JSON.stringify(request)), request);
  }
  assert.equal(defaultJevRoutingConfig().mappings.complex.model, "gpt-5.6-sol");
  for (const effort of ["none", "minimal"]) {
    assert.equal(supportsJevRoute(model, effort), false);
    assert.throws(() => normalizeJevRoutingConfig(configFor(effort)), /推理强度不受支持/);
    assert.equal(parseNativeJevRoutingRequest(JSON.stringify({
      id: "save-sol61", kind: "set-mappings", mappings: configFor(effort).mappings
    })), null);
  }
});

test("native snapshots retain GPT-6.1 Sol mappings and receipts while rejecting unsupported efforts", () => {
  for (const effort of efforts) {
    const config = configFor(effort);
    const receipt = { threadId, turnId, model, effort, tier: "complex", confidence: 0.91, source: "jev" };
    const normalizedReceipt = normalizeJevRoutingReceipt(receipt);
    assert.equal(normalizedReceipt.model, model);
    assert.equal(normalizeJevRoutingReceipt({ ...receipt, effort: "none" }), null);
    assert.equal(normalizeJevRoutingReceipt({ ...receipt, effort: "minimal" }), null);
    const snapshot = normalizeNativeJevRoutingSnapshot({
      config: { ...config, mappings: { ...config.mappings, invalid: { model, effort: "minimal" } } },
      available: true, threadOverrides: { [threadId]: true },
      receipts: [receipt, { ...receipt, effort: "none" }, { ...receipt, effort: "minimal" }]
    });
    assert.deepEqual(snapshot.mappings, config.mappings);
    assert.equal(snapshot.receipts.length, 1);
    assert.deepEqual(snapshot.receipts[0], normalizedReceipt);
    assert.equal(snapshot.enabled, false);
    assert.equal(snapshot.transportMode, "native");
    assert.equal(snapshot.fallbackTier, "deep");
    assert.deepEqual(snapshot.threadOverrides, { [threadId]: true });
  }
});

test("native GPT-6.1 Sol routing messages use the readable model label", () => {
  assert.equal(formatNativeJevTurnChoice({ tier: "complex", model, effort: "ultra" }),
    "Jev · 复杂 · GPT-6.1 Sol · Ultra");
  assert.equal(formatNativeJevModelChange({ model, effort: "high", confidence: 0.91 }),
    "模型已设置为 GPT-6.1 Sol，推理强度 高，置信度 0.91。");
  assert.equal(formatNativeJevModelChange({ model, effort: "ultra", confidence: 0.91, source: "inherited" }),
    "模型已沿用为 GPT-6.1 Sol，推理强度 Ultra，上一轮置信度 0.91。");
});

test("native emitted panel and dashboard expose the same model and effort contract", async () => {
  assert.deepEqual(JEV_MODELS, JEV_ROUTE_MODELS);
  assert.deepEqual(JEV_MODEL_EFFORTS, JEV_ROUTE_MODEL_EFFORTS);
  assert.deepEqual(JEV_MODEL_EFFORTS[model], efforts);

  const panelSource = buildNativeJevRoutingPanelSource();
  const panel = JSON.parse(vm.runInNewContext(`${panelSource}\nJSON.stringify({
    models: ROUTE_MODEL_OPTIONS, efforts: ROUTE_MODEL_EFFORTS,
    options: ROUTE_EFFORT_OPTIONS, defaults: ROUTE_DEFAULT_MAPPINGS
  })`));
  assert.deepEqual(panel.models.map(([id]) => id), JEV_ROUTE_MODELS);
  assert.deepEqual(panel.efforts, JEV_ROUTE_MODEL_EFFORTS);
  assert.deepEqual(panel.options.map(([id]) => id), efforts);
  assert.deepEqual(panel.models.find(([id]) => id === model), [model, "GPT-6.1 Sol"]);
  assert.deepEqual(Object.fromEntries(Object.entries(panel.defaults).map(([tier, [id, effort]]) =>
    [tier, { model: id, effort }])), defaultJevRoutingConfig().mappings);

  const injectionSource = buildNativeJevRoutingInjectionScript();
  assert.equal(injectionSource.includes(panelSource), true);
  assert.doesNotThrow(() => new Function(injectionSource));
  assert.match(injectionSource, /JevRoutingVersion === '2026-09-30\.sol61'/);
  assert.match(injectionSource, /JevRoutingVersion = '2026-09-30\.sol61'/);
  assert.doesNotMatch(injectionSource, /2026-09-28\.claude1/);

  const dashboardSource = await fs.readFile(new URL("../public/features/jev-routing/index.js", import.meta.url), "utf8");
  const dashboardScript = dashboardSource.replace(/^import .*;\n/m, "").replace(/^export /gm, "");
  assert.equal(vm.runInNewContext(`${dashboardScript}\nmodelLabel(${JSON.stringify(model)})`), "GPT-6.1 Sol");
});

test("a running previous native Jev installation is cleaned up and replaced once", () => {
  const calls = { input: 0, mutation: 0, restore: 0, panel: 0, unload: 0 };
  const oldSubscriber = () => {};
  const subscribers = new Set([oldSubscriber]);
  const window = {
    __codexControlConsoleJevRoutingVersion: "2026-09-28.claude1",
    __codexControlConsoleMutationSubscribers: subscribers,
    __codexControlConsoleJevRoutingInputCleanup() { calls.input += 1; },
    __codexControlConsoleJevRoutingMutationCleanup() { calls.mutation += 1; subscribers.delete(oldSubscriber); },
    __codexControlConsoleRestoreJevNativeModelControl() { calls.restore += 1; },
    addEventListener() { calls.unload += 1; }
  };
  const document = {
    querySelector(selector) {
      return selector === "[data-codex-control-console-jev-routing-panel]"
        ? { remove() { calls.panel += 1; } } : null;
    },
    querySelectorAll() { return []; }, addEventListener() {}, removeEventListener() {}
  };
  const context = vm.createContext({
    window, document, localStorage: { getItem() { return "[]"; } },
    setTimeout, clearTimeout, clearInterval() {}, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {}
  });
  const source = buildNativeJevRoutingInjectionScript();
  vm.runInContext(source, context);
  assert.equal(window.__codexControlConsoleJevRoutingVersion, "2026-09-30.sol61");
  assert.deepEqual(calls, { input: 1, mutation: 1, restore: 1, panel: 1, unload: 1 });
  assert.equal(subscribers.size, 1);
  assert.equal(subscribers.has(oldSubscriber), false);
  const setter = window.__codexControlConsoleSetJevRouting;
  assert.equal(typeof setter, "function");
  vm.runInContext(source, context);
  assert.equal(window.__codexControlConsoleSetJevRouting, setter);
  assert.equal(subscribers.size, 1);
  assert.deepEqual(calls, { input: 1, mutation: 1, restore: 1, panel: 1, unload: 1 });
});
