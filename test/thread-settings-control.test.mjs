import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeThreadSettingsChange,
  normalizeSettingsOptions,
  RemoteThreadSettingsService,
  validateThreadSettingsChange,
  validateThreadSettingsTransport
} from "../src/thread-settings-control.mjs";

const threadId = "01a04445-8d03-7243-a4d3-181180bb626d";
const models = [
  {
    id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", description: "Frontier",
    defaultReasoningEffort: "medium", reasoningEfforts: [{ effort: "medium" }, { effort: "max", description: "Deep" }],
    serviceTiers: [{ id: "default", name: "Standard" }, { id: "priority", name: "Fast", description: "1.5x" }]
  },
  {
    id: "gpt-5.6-terra", displayName: "GPT-5.6 Terra", description: null,
    defaultReasoningEffort: "high", reasoningEfforts: [{ effort: "low" }, { effort: "high" }],
    serviceTiers: [{ id: "default", name: "Standard" }]
  }
];
const options = normalizeSettingsOptions(models, 1_000_000);
const task = {
  id: threadId,
  status: "active",
  model: "gpt-5.6-sol",
  reasoningEffort: "max",
  serviceTier: "default",
  approvalPolicy: "never",
  permissionProfile: ":danger-full-access",
  accessMode: "full-access",
  contextOverrideState: "default",
  requestedContextWindow: null,
  modelContextWindow: 258_400
};

test("thread setting transport accepts only bounded UI categories", () => {
  assert.deepEqual(validateThreadSettingsTransport({ threadId: threadId.toUpperCase(), changes: { model: "gpt-5.6-sol", reasoningEffort: "max" } }), {
    threadId,
    changes: { model: "gpt-5.6-sol", reasoningEffort: "max" }
  });
  assert.throws(() => validateThreadSettingsTransport({ threadId, changes: {} }), /无效/);
  assert.throws(() => validateThreadSettingsTransport({ threadId, changes: { sandbox: "disabled" } }), /无效/);
  assert.throws(() => validateThreadSettingsTransport({ threadId, changes: { accessMode: "root" } }), /访问权限/);
  assert.deepEqual(validateThreadSettingsTransport({ threadId, changes: { serviceTier: "priority" } }).changes, { serviceTier: "priority" });
  assert.throws(() => validateThreadSettingsTransport({ threadId, changes: { serviceTier: "flex" } }), /推理速度/);
  assert.throws(() => validateThreadSettingsTransport({ threadId, changes: { contextOverrideState: "extended", model: "gpt-5.6-sol" } }), /不能与其他设置/);
});

test("owner catalog reconciles model and effort before native application", () => {
  const changed = validateThreadSettingsChange({ threadId, changes: { model: "gpt-5.6-terra" } }, { current: task, options });
  assert.deepEqual(changed.changes, { model: "gpt-5.6-terra", reasoningEffort: "high" });
  assert.throws(() => validateThreadSettingsChange({ threadId, changes: { reasoningEffort: "ultra" } }, { current: task, options }), /不支持/);
  assert.throws(() => validateThreadSettingsChange({ threadId, changes: { model: "invented" } }, { current: task, options }), /不支持/);
  assert.deepEqual(validateThreadSettingsChange({ threadId, changes: { serviceTier: "priority" } }, { current: task, options }).changes, { serviceTier: "priority" });
  assert.throws(() => validateThreadSettingsChange({ threadId, changes: { model: "gpt-5.6-terra", serviceTier: "priority" } }, { current: task, options }), /推理速度/);
});

test("normalized settings map only to built-in native fields", () => {
  assert.deepEqual(nativeThreadSettingsChange({ model: "gpt-5.6-sol", reasoningEffort: "max", serviceTier: "priority", accessMode: "workspace" }, options), {
    model: "gpt-5.6-sol", reasoningEffort: "max", serviceTier: "priority", permissionProfile: ":workspace"
  });
  assert.deepEqual(nativeThreadSettingsChange({ contextOverrideState: "extended" }, options), { contextWindow: 1_000_000 });
  assert.deepEqual(nativeThreadSettingsChange({ contextOverrideState: "default" }, options), { contextWindow: null });
});

test("owner applies native settings before persisting context and confirms next-turn state", async () => {
  const order = [];
  const service = new RemoteThreadSettingsService({
    localAdapter: { async getTask(id) { assert.equal(id, threadId); return task; } },
    nativeAdapter: { async apply(input) { order.push(["native", input.changes.contextWindow]); return { applied: true, ownerSurface: "primary-native", ownerBridge: "writer-matched" }; } },
    contextWindowStore: {
      async set(id, value) { order.push(["store", id, value]); },
      async remove() { throw new Error("unexpected remove"); }
    },
    modelCatalog: { async listOptions() { return models; } },
    contextWindow: 1_000_000,
    now: () => 1_000
  });
  const result = await service.update({ threadId, changes: { contextOverrideState: "extended" } });
  assert.deepEqual(order, [["native", 1_000_000], ["store", threadId, 1_000_000]]);
  assert.equal(result.effectiveFrom, "next-turn");
  assert.equal(result.activeTurnPreserved, true);
  assert.equal(result.settings.contextOverrideState, "extended");
  assert.equal(result.ownerSurface, "primary-native");
  assert.equal(result.ownerBridge, "writer-matched");
  const activity = await service.decorateActivity({ threadId, contextOverrideState: "default", entries: [] });
  assert.equal(activity.contextOverrideState, "extended");
  assert.equal(activity.settingsOptions.models.length, 2);
});

test("failed native acknowledgement leaves the context store untouched", async () => {
  let writes = 0;
  const service = new RemoteThreadSettingsService({
    localAdapter: { async getTask() { return task; } },
    nativeAdapter: { async apply() { throw new Error("native rejected"); } },
    contextWindowStore: { async set() { writes += 1; }, async remove() { writes += 1; } },
    modelCatalog: { async listOptions() { return models; } }
  });
  await assert.rejects(() => service.update({ threadId, changes: { contextOverrideState: "extended" } }), /native rejected/);
  assert.equal(writes, 0);
});
