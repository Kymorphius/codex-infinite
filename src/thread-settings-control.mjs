import { httpError } from "./http-utils.mjs";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANGE_FIELDS = Object.freeze(["model", "reasoningEffort", "serviceTier", "accessMode", "contextOverrideState"]);
export const EDITABLE_ACCESS_MODES = Object.freeze(["read-only", "workspace", "full-access"]);
export const EDITABLE_SERVICE_TIERS = Object.freeze(["default", "priority", "ultrafast"]);
const ACCESS_PROFILES = Object.freeze({
  "read-only": ":read-only",
  workspace: ":workspace",
  "full-access": ":danger-full-access"
});

function boundedText(value, maxLength, message) {
  if (typeof value !== "string") throw httpError(400, message);
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text || text.length > maxLength) throw httpError(400, message);
  return text;
}

export function normalizeSettingsOptions(models = [], contextWindow = 1_000_000) {
  const normalizedModels = (Array.isArray(models) ? models : []).slice(0, 16).flatMap((model) => {
    const id = typeof model?.id === "string" ? model.id.trim().slice(0, 120) : "";
    if (!id) return [];
    const efforts = (Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : []).slice(0, 8).flatMap((item) => {
      const effort = typeof item?.effort === "string" ? item.effort.trim().slice(0, 40) : "";
      return effort ? [{ effort, description: typeof item.description === "string" ? item.description.trim().slice(0, 180) || null : null }] : [];
    });
    const serviceTiers = (Array.isArray(model.serviceTiers) ? model.serviceTiers : [{ id: "default", name: "Standard", description: "Default speed" }]).slice(0, 4).flatMap((item) => {
      const rawId = typeof item?.id === "string" ? item.id.trim().toLowerCase().slice(0, 40) : "";
      const tierId = rawId === "fast" ? "priority" : rawId;
      if (!EDITABLE_SERVICE_TIERS.includes(tierId)) return [];
      return [{
        id: tierId,
        name: typeof item.name === "string" ? item.name.trim().slice(0, 80) || tierId : tierId,
        description: typeof item.description === "string" ? item.description.trim().slice(0, 180) || null : null
      }];
    }).filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
    if (!serviceTiers.some((item) => item.id === "default")) serviceTiers.unshift({ id: "default", name: "Standard", description: "Default speed" });
    if (serviceTiers.length > 4) serviceTiers.length = 4;
    const defaultEffort = typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort.trim().slice(0, 40) : "";
    return [{
      id,
      displayName: typeof model.displayName === "string" ? model.displayName.trim().slice(0, 120) || id : id,
      description: typeof model.description === "string" ? model.description.trim().slice(0, 240) || null : null,
      defaultReasoningEffort: efforts.some((item) => item.effort === defaultEffort) ? defaultEffort : efforts[0]?.effort || null,
      reasoningEfforts: efforts,
      serviceTiers
    }];
  });
  return Object.freeze({
    models: Object.freeze(normalizedModels.map((model) => Object.freeze({
      ...model,
      reasoningEfforts: Object.freeze(model.reasoningEfforts.map((item) => Object.freeze(item))),
      serviceTiers: Object.freeze(model.serviceTiers.map((item) => Object.freeze(item)))
    }))),
    accessModes: EDITABLE_ACCESS_MODES,
    contextWindow: Number.isSafeInteger(contextWindow) && contextWindow >= 32_000 && contextWindow <= 2_000_000 ? contextWindow : 1_000_000
  });
}

export function validateThreadSettingsTransport(input = {}) {
  const threadId = boundedText(input.threadId, 160, "会话标识无效").toLowerCase();
  if (!THREAD_ID_PATTERN.test(threadId)) throw httpError(400, "会话标识无效");
  const changes = input.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw httpError(400, "会话设置变更无效");
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !CHANGE_FIELDS.includes(key))) throw httpError(400, "会话设置变更无效");
  if (keys.includes("contextOverrideState") && keys.length > 1) throw httpError(400, "上下文切换不能与其他设置同时提交");
  const normalized = {};
  if (Object.hasOwn(changes, "model")) normalized.model = boundedText(changes.model, 120, "模型无效");
  if (Object.hasOwn(changes, "reasoningEffort")) normalized.reasoningEffort = boundedText(changes.reasoningEffort, 40, "推理强度无效");
  if (Object.hasOwn(changes, "serviceTier")) {
    const serviceTier = boundedText(changes.serviceTier, 40, "推理速度无效").toLowerCase();
    if (!EDITABLE_SERVICE_TIERS.includes(serviceTier)) throw httpError(400, "推理速度无效");
    normalized.serviceTier = serviceTier;
  }
  if (Object.hasOwn(changes, "accessMode")) {
    if (!EDITABLE_ACCESS_MODES.includes(changes.accessMode)) throw httpError(400, "访问权限无效");
    normalized.accessMode = changes.accessMode;
  }
  if (Object.hasOwn(changes, "contextOverrideState")) {
    if (!["extended", "default"].includes(changes.contextOverrideState)) throw httpError(400, "上下文状态无效");
    normalized.contextOverrideState = changes.contextOverrideState;
  }
  return Object.freeze({ threadId, changes: Object.freeze(normalized) });
}

export function validateThreadSettingsChange(input = {}, { current = {}, options = normalizeSettingsOptions() } = {}) {
  const transported = validateThreadSettingsTransport(input);
  const { threadId, changes } = transported;
  const normalized = {};
  const model = Object.hasOwn(changes, "model")
    ? changes.model
    : typeof current.model === "string" ? current.model : null;
  const modelOption = options.models.find((item) => item.id === model) || null;
  if (Object.hasOwn(changes, "model") && !modelOption) throw httpError(400, "所属节点不支持这个模型");
  if (Object.hasOwn(changes, "model")) normalized.model = model;

  let effort = Object.hasOwn(changes, "reasoningEffort")
    ? changes.reasoningEffort
    : typeof current.reasoningEffort === "string" ? current.reasoningEffort : null;
  if (modelOption && effort && !modelOption.reasoningEfforts.some((item) => item.effort === effort)) {
    if (Object.hasOwn(changes, "reasoningEffort")) throw httpError(400, "这个模型不支持所选推理强度");
    effort = modelOption.defaultReasoningEffort;
  }
  if (Object.hasOwn(changes, "reasoningEffort") || (Object.hasOwn(changes, "model") && effort !== current.reasoningEffort)) {
    if (!modelOption || !effort || !modelOption.reasoningEfforts.some((item) => item.effort === effort)) throw httpError(400, "所属节点无法确认推理强度");
    normalized.reasoningEffort = effort;
  }

  let serviceTier = Object.hasOwn(changes, "serviceTier")
    ? changes.serviceTier
    : typeof current.serviceTier === "string" ? current.serviceTier : "default";
  if (modelOption && !modelOption.serviceTiers.some((item) => item.id === serviceTier)) {
    if (Object.hasOwn(changes, "serviceTier")) throw httpError(400, "这个模型不支持所选推理速度");
    serviceTier = "default";
  }
  if (Object.hasOwn(changes, "serviceTier") || (Object.hasOwn(changes, "model") && serviceTier !== (current.serviceTier || "default"))) {
    if (!modelOption || !modelOption.serviceTiers.some((item) => item.id === serviceTier)) throw httpError(400, "所属节点无法确认推理速度");
    normalized.serviceTier = serviceTier;
  }

  if (Object.hasOwn(changes, "accessMode")) {
    if (!options.accessModes.includes(changes.accessMode)) throw httpError(400, "所属节点不支持这个访问权限");
    normalized.accessMode = changes.accessMode;
  }
  if (Object.hasOwn(changes, "contextOverrideState")) {
    normalized.contextOverrideState = changes.contextOverrideState;
  }
  return Object.freeze({ threadId, changes: Object.freeze(normalized) });
}

export function nativeThreadSettingsChange(changes, options) {
  const output = {};
  if (Object.hasOwn(changes, "model")) output.model = changes.model;
  if (Object.hasOwn(changes, "reasoningEffort")) output.reasoningEffort = changes.reasoningEffort;
  if (Object.hasOwn(changes, "serviceTier")) output.serviceTier = changes.serviceTier;
  if (Object.hasOwn(changes, "accessMode")) output.permissionProfile = ACCESS_PROFILES[changes.accessMode];
  if (Object.hasOwn(changes, "contextOverrideState")) {
    output.contextWindow = changes.contextOverrideState === "extended" ? options.contextWindow : null;
  }
  return Object.freeze(output);
}

function projectedSettings(current, changes, options) {
  const output = {
    model: current.model || null,
    reasoningEffort: current.reasoningEffort || null,
    serviceTier: current.serviceTier || null,
    approvalPolicy: current.approvalPolicy || null,
    permissionProfile: current.permissionProfile || null,
    accessMode: current.accessMode || "unknown",
    contextOverrideState: current.contextOverrideState || "unknown",
    requestedContextWindow: current.requestedContextWindow || null,
    modelContextWindow: current.modelContextWindow || null
  };
  if (changes.model) {
    output.model = changes.model;
    output.modelContextWindow = null;
  }
  if (changes.reasoningEffort) output.reasoningEffort = changes.reasoningEffort;
  if (Object.hasOwn(changes, "serviceTier")) output.serviceTier = changes.serviceTier;
  if (changes.accessMode) {
    output.accessMode = changes.accessMode;
    output.permissionProfile = ACCESS_PROFILES[changes.accessMode];
    output.approvalPolicy = null;
  }
  if (changes.contextOverrideState) {
    output.contextOverrideState = changes.contextOverrideState;
    output.requestedContextWindow = changes.contextOverrideState === "extended" ? options.contextWindow : null;
  }
  return Object.freeze(output);
}

function projectedOverlay(changes, options) {
  const output = {};
  if (changes.model) {
    output.model = changes.model;
    output.modelContextWindow = null;
  }
  if (changes.reasoningEffort) output.reasoningEffort = changes.reasoningEffort;
  if (Object.hasOwn(changes, "serviceTier")) output.serviceTier = changes.serviceTier;
  if (changes.accessMode) {
    output.accessMode = changes.accessMode;
    output.permissionProfile = ACCESS_PROFILES[changes.accessMode];
    output.approvalPolicy = null;
  }
  if (changes.contextOverrideState) {
    output.contextOverrideState = changes.contextOverrideState;
    output.requestedContextWindow = changes.contextOverrideState === "extended" ? options.contextWindow : null;
  }
  return Object.freeze(output);
}

export class RemoteThreadSettingsService {
  constructor({ localAdapter, nativeAdapter, contextWindowStore, modelCatalog, contextWindow = 1_000_000, now = () => Date.now() } = {}) {
    this.localAdapter = localAdapter;
    this.nativeAdapter = nativeAdapter;
    this.contextWindowStore = contextWindowStore;
    this.modelCatalog = modelCatalog;
    this.contextWindow = contextWindow;
    this.now = now;
    this.confirmed = new Map();
  }

  async options() {
    return normalizeSettingsOptions(await this.modelCatalog?.listOptions?.() || [], this.contextWindow);
  }

  async update(input) {
    const transported = validateThreadSettingsTransport(input);
    const task = await this.localAdapter.getTask(transported.threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    if (!this.nativeAdapter?.apply) throw httpError(503, "所属节点的原生设置服务不可用");
    const options = await this.options();
    const normalized = validateThreadSettingsChange(transported, { current: task, options });
    if (Object.hasOwn(normalized.changes, "contextOverrideState") && (!this.contextWindowStore?.set || !this.contextWindowStore?.remove)) {
      throw httpError(503, "所属节点的上下文设置服务不可用");
    }
    const nativeChanges = nativeThreadSettingsChange(normalized.changes, options);
    const nativeResult = await this.nativeAdapter.apply({ threadId: normalized.threadId, changes: nativeChanges });
    if (Object.hasOwn(normalized.changes, "contextOverrideState")) {
      if (normalized.changes.contextOverrideState === "extended") await this.contextWindowStore.set(normalized.threadId, options.contextWindow);
      else await this.contextWindowStore.remove(normalized.threadId);
    }
    const settings = projectedSettings(task, normalized.changes, options);
    this.confirmed.set(normalized.threadId, {
      settings,
      overlay: projectedOverlay(normalized.changes, options),
      changes: normalized.changes,
      savedAt: this.now()
    });
    return Object.freeze({
      accepted: true,
      threadId: normalized.threadId,
      effectiveFrom: "next-turn",
      activeTurnPreserved: task.status === "active",
      settings,
      settingsOptions: options,
      executionAuthority: "owner-native-desktop",
      ownerSurface: ["primary-native", "dedicated-native"].includes(nativeResult?.ownerSurface) ? nativeResult.ownerSurface : "dedicated-native",
      ownerBridge: ["writer-matched", "dormant-fallback"].includes(nativeResult?.ownerBridge) ? nativeResult.ownerBridge : "dormant-fallback"
    });
  }

  async decorateActivity(activity) {
    if (!activity) return activity;
    const threadId = String(activity.threadId || "").toLowerCase();
    let confirmed = this.confirmed.get(threadId);
    if (confirmed && this.now() - confirmed.savedAt > 24 * 60 * 60 * 1000) this.confirmed.delete(threadId);
    if (confirmed && Object.entries(confirmed.changes).every(([key, value]) => activity[key] === value)) {
      this.confirmed.delete(threadId);
      confirmed = null;
    }
    const overlay = confirmed && this.now() - confirmed.savedAt <= 24 * 60 * 60 * 1000 ? confirmed.overlay : null;
    return { ...activity, ...(overlay || {}), settingsOptions: await this.options() };
  }
}
