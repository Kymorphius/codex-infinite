import { httpError } from "./http-utils.mjs";
import { TURBO_ACCESS_MODES, TURBO_REASONING_MODES } from "./turbo-policy.mjs";

const POLICY_FIELDS = Object.freeze(["enabled", "model", "reasoningEffort", "fast", "millionContext", "accessMode", "deviceIds"]);

function projectPolicy(policy = {}) {
  return Object.freeze({
    enabled: policy.enabled === true,
    model: typeof policy.model === "string" ? policy.model : null,
    reasoningEffort: TURBO_REASONING_MODES.includes(policy.reasoningEffort) ? policy.reasoningEffort : "maximum",
    fast: policy.fast !== false,
    millionContext: policy.millionContext === true,
    accessMode: TURBO_ACCESS_MODES.includes(policy.accessMode) ? policy.accessMode : "preserve",
    deviceIds: Object.freeze(Array.isArray(policy.deviceIds) ? [...policy.deviceIds] : [])
  });
}

export function validateTurboChange(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => ![...POLICY_FIELDS, "requestId"].includes(key))) {
    throw httpError(400, "Turbo 设置无效");
  }
  if (!POLICY_FIELDS.some((key) => Object.hasOwn(input, key))) throw httpError(400, "Turbo 设置不能为空");
  if (Object.hasOwn(input, "enabled") && typeof input.enabled !== "boolean") throw httpError(400, "Turbo 开关必须是布尔值");
  if (Object.hasOwn(input, "model") && input.model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(String(input.model))) throw httpError(400, "Turbo 模型无效");
  if (Object.hasOwn(input, "reasoningEffort") && !TURBO_REASONING_MODES.includes(input.reasoningEffort)) throw httpError(400, "Turbo 推理强度无效");
  if (Object.hasOwn(input, "fast") && typeof input.fast !== "boolean") throw httpError(400, "Turbo 推理速度设置必须是布尔值");
  if (Object.hasOwn(input, "millionContext") && typeof input.millionContext !== "boolean") throw httpError(400, "Turbo 百万上下文设置必须是布尔值");
  if (Object.hasOwn(input, "accessMode") && !TURBO_ACCESS_MODES.includes(input.accessMode)) throw httpError(400, "Turbo 访问权限无效");
  if (Object.hasOwn(input, "deviceIds") && (!Array.isArray(input.deviceIds) || input.deviceIds.length > 32 || input.deviceIds.some((id) => !/^[A-Za-z0-9_.:-]{1,80}$/.test(String(id))))) throw httpError(400, "Turbo 设备范围无效");
  if (Object.hasOwn(input, "requestId") && !/^[A-Za-z0-9_-]{16,128}$/.test(String(input.requestId))) throw httpError(400, "Turbo 请求标识无效");
  const change = {};
  for (const key of POLICY_FIELDS) if (Object.hasOwn(input, key)) change[key] = key === "deviceIds" ? [...new Set(input[key])] : input[key];
  return Object.freeze(change);
}

export class TurboCoordinator {
  constructor({ localService, peerAdapters = [], localNode } = {}) {
    this.localService = localService;
    this.peerAdapters = peerAdapters;
    this.localNode = localNode;
    this.lastNodes = [];
  }

  read() {
    const policy = this.localService.snapshot();
    return Object.freeze({ ...projectPolicy(policy), active: policy.active === true, modelEfforts: policy.modelEfforts || [], modelOptions: policy.modelOptions || [], devices: policy.devices || [], updatedAt: policy.updatedAt, nodes: Object.freeze([...this.lastNodes]) });
  }

  async setEnabled(enabled) {
    return this.update({ enabled });
  }

  async update(change) {
    const [local, remoteResults] = await Promise.all([
      this.localService.update(change),
      Promise.all(this.peerAdapters.map(async (peer) => {
        try {
          const result = await peer.updateTurbo(change);
          return { id: peer.peer.id, name: peer.peer.name, status: "applied", policy: projectPolicy(result), transport: result.transport };
        } catch {
          return { id: peer.peer.id, name: peer.peer.name, status: "error", policy: null };
        }
      }))
    ]);
    const effectivePolicy = projectPolicy(local);
    const localResult = { id: this.localNode?.id || "local", name: this.localNode?.name || "本机", status: "applied", policy: effectivePolicy };
    this.lastNodes = Object.freeze([localResult, ...remoteResults].map(Object.freeze));
    return Object.freeze({
      ...effectivePolicy,
      updatedAt: local.updatedAt,
      converged: remoteResults.every((item) => item.status === "applied" && JSON.stringify(item.policy) === JSON.stringify(effectivePolicy)),
      nodes: this.lastNodes
    });
  }
}
