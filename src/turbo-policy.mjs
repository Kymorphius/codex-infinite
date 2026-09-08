import fs from "node:fs/promises";
import path from "node:path";

const EFFORT_ORDER = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
export const TURBO_ACCESS_MODES = Object.freeze(["preserve", "read-only", "workspace", "full-access"]);
export const TURBO_REASONING_MODES = Object.freeze(["preserve", "maximum", ...EFFORT_ORDER]);

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength) : "";
}

export function highestModelEfforts(models = []) {
  return (Array.isArray(models) ? models : []).slice(0, 32).flatMap((model) => {
    const id = cleanText(model?.id, 120);
    if (!id) return [];
    const efforts = (Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : [])
      .map((item) => cleanText(item?.effort, 40)).filter((effort) => EFFORT_ORDER.includes(effort));
    const effort = efforts.sort((left, right) => EFFORT_ORDER.indexOf(right) - EFFORT_ORDER.indexOf(left))[0];
    return effort ? [{ model: id, effort }] : [];
  });
}

export function normalizeTurboModelOptions(models = []) {
  return Object.freeze((Array.isArray(models) ? models : []).slice(0, 32).flatMap((model) => {
    const id = cleanText(model?.id, 120);
    if (!id) return [];
    const efforts = (Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : Array.isArray(model.efforts) ? model.efforts.map((effort) => ({ effort })) : [])
      .map((item) => cleanText(item?.effort, 40)).filter((effort, index, items) => EFFORT_ORDER.includes(effort) && items.indexOf(effort) === index).slice(0, 8);
    return [{ id, efforts: Object.freeze(efforts) }];
  }));
}

function normalizeStoredPolicy(value = {}) {
  const model = value.model === null ? null : cleanText(value.model, 120) || null;
  const reasoningEffort = cleanText(value.reasoningEffort, 40);
  const accessMode = cleanText(value.accessMode, 40);
  const deviceIds = (Array.isArray(value.deviceIds) ? value.deviceIds : []).map((item) => cleanText(item, 80))
    .filter((item, index, items) => /^[A-Za-z0-9_.:-]{1,80}$/.test(item) && items.indexOf(item) === index).slice(0, 32);
  return Object.freeze({
    enabled: value.enabled === true,
    model,
    reasoningEffort: TURBO_REASONING_MODES.includes(reasoningEffort) ? reasoningEffort : "maximum",
    fast: value.fast !== false,
    millionContext: value.millionContext === true,
    accessMode: TURBO_ACCESS_MODES.includes(accessMode) ? accessMode : "preserve",
    deviceIds: Object.freeze(deviceIds),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    modelOptions: normalizeTurboModelOptions(value.modelOptions),
    modelEfforts: Object.freeze(highestModelEfforts((Array.isArray(value.modelEfforts) ? value.modelEfforts : []).map((item) => ({ id: item.model, reasoningEfforts: [{ effort: item.effort }] }))))
  });
}

export class TurboPolicyStore {
  constructor({ filePath, now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.policy = normalizeStoredPolicy();
  }

  async init() {
    try { this.policy = normalizeStoredPolicy(JSON.parse(await fs.readFile(this.filePath, "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await this.save();
    return this.snapshot();
  }

  snapshot() { return this.policy; }

  async set(value) {
    this.policy = normalizeStoredPolicy({ ...value, updatedAt: this.now().toISOString() });
    await this.save();
    return this.snapshot();
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify({ version: 2, ...this.policy }, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.filePath);
  }
}

export class TurboPolicyService {
  constructor({ store, modelCatalog, nodeId = "local", devices = [] } = {}) {
    this.store = store;
    this.modelCatalog = modelCatalog;
    this.nodeId = nodeId;
    this.devices = Object.freeze((Array.isArray(devices) ? devices : []).slice(0, 32).flatMap((device) => {
      const id = cleanText(device?.id, 80);
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return [];
      return [Object.freeze({ id, name: cleanText(device?.name, 120) || id })];
    }));
  }

  snapshot() {
    const policy = this.store.snapshot();
    return Object.freeze({
      ...policy,
      active: policy.enabled && (!policy.deviceIds.length || policy.deviceIds.includes(this.nodeId)),
      devices: this.devices
    });
  }

  async setEnabled(enabled) {
    if (typeof enabled !== "boolean") throw new Error("Turbo 开关必须是布尔值");
    return this.update({ enabled });
  }

  async refreshCatalog() {
    const current = this.store.snapshot();
    const models = await (this.modelCatalog?.listOptions?.({ limit: 32 }) || []);
    return this.store.set({ ...current, modelOptions: normalizeTurboModelOptions(models), modelEfforts: highestModelEfforts(models) });
  }

  async update(change = {}) {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw new Error("Turbo 设置无效");
    const keys = Object.keys(change);
    const allowed = ["enabled", "model", "reasoningEffort", "fast", "millionContext", "accessMode", "deviceIds"];
    if (!keys.length || keys.some((key) => !allowed.includes(key))) throw new Error("Turbo 设置无效");
    if (Object.hasOwn(change, "enabled") && typeof change.enabled !== "boolean") throw new Error("Turbo 开关必须是布尔值");
    if (Object.hasOwn(change, "model") && change.model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(String(change.model))) throw new Error("Turbo 模型无效");
    if (Object.hasOwn(change, "reasoningEffort") && !TURBO_REASONING_MODES.includes(change.reasoningEffort)) throw new Error("Turbo 推理强度无效");
    if (Object.hasOwn(change, "fast") && typeof change.fast !== "boolean") throw new Error("Turbo 推理速度设置必须是布尔值");
    if (Object.hasOwn(change, "millionContext") && typeof change.millionContext !== "boolean") throw new Error("Turbo 百万上下文设置必须是布尔值");
    if (Object.hasOwn(change, "accessMode") && !TURBO_ACCESS_MODES.includes(change.accessMode)) throw new Error("Turbo 访问权限无效");
    if (Object.hasOwn(change, "deviceIds") && (!Array.isArray(change.deviceIds) || change.deviceIds.length > 32 || change.deviceIds.some((id) => !/^[A-Za-z0-9_.:-]{1,80}$/.test(String(id))))) throw new Error("Turbo 设备范围无效");
    const current = this.snapshot();
    const models = await (this.modelCatalog?.listOptions?.({ limit: 32 }) || []);
    const modelEfforts = highestModelEfforts(models);
    const model = Object.hasOwn(change, "model") ? change.model : current.model;
    const reasoningEffort = Object.hasOwn(change, "reasoningEffort") ? change.reasoningEffort : current.reasoningEffort;
    const selectedModel = model === null ? null : models.find((item) => item.id === model);
    const strategyChanged = Object.hasOwn(change, "model") || Object.hasOwn(change, "reasoningEffort");
    if (strategyChanged && model && !selectedModel) throw new Error("所属节点不支持所选 Turbo 模型");
    if (strategyChanged && !model && !["preserve", "maximum"].includes(reasoningEffort)) throw new Error("指定推理强度前必须指定 Turbo 模型");
    if (strategyChanged && selectedModel && !["preserve", "maximum"].includes(reasoningEffort) && !selectedModel.reasoningEfforts?.some((item) => item.effort === reasoningEffort)) throw new Error("Turbo 模型不支持所选推理强度");
    return this.store.set({
      enabled: Object.hasOwn(change, "enabled") ? change.enabled : current.enabled,
      model,
      reasoningEffort,
      fast: Object.hasOwn(change, "fast") ? change.fast : current.fast,
      millionContext: Object.hasOwn(change, "millionContext") ? change.millionContext : current.millionContext,
      accessMode: Object.hasOwn(change, "accessMode") ? change.accessMode : current.accessMode,
      deviceIds: Object.hasOwn(change, "deviceIds") ? change.deviceIds : current.deviceIds,
      modelOptions: normalizeTurboModelOptions(models),
      modelEfforts
    });
  }
}
