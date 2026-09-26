import { httpError } from "./http-utils.mjs";
import { TURBO_ACCESS_MODES, TURBO_REASONING_MODES } from "./turbo-policy.mjs";

export const TURBO_POLICY_FIELDS = Object.freeze(["enabled", "model", "reasoningEffort", "fast", "millionContext", "autoDisableGlobalRouting", "accessMode", "deviceIds"]);

function projectPolicy(policy = {}) {
  return Object.freeze({
    enabled: policy.enabled === true,
    model: typeof policy.model === "string" ? policy.model : null,
    reasoningEffort: TURBO_REASONING_MODES.includes(policy.reasoningEffort) ? policy.reasoningEffort : "maximum",
    fast: policy.fast !== false,
    millionContext: policy.millionContext === true,
    autoDisableGlobalRouting: policy.autoDisableGlobalRouting === true,
    accessMode: TURBO_ACCESS_MODES.includes(policy.accessMode) ? policy.accessMode : "preserve",
    deviceIds: Object.freeze(Array.isArray(policy.deviceIds) ? [...policy.deviceIds] : [])
  });
}

export function validateTurboChange(input = {}, { allowRequestId = true } = {}) {
  const allowed = allowRequestId ? [...TURBO_POLICY_FIELDS, "requestId"] : TURBO_POLICY_FIELDS;
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !allowed.includes(key))) {
    throw httpError(400, "Turbo 设置无效");
  }
  if (!TURBO_POLICY_FIELDS.some((key) => Object.hasOwn(input, key))) throw httpError(400, "Turbo 设置不能为空");
  if (Object.hasOwn(input, "enabled") && typeof input.enabled !== "boolean") throw httpError(400, "Turbo 开关必须是布尔值");
  if (Object.hasOwn(input, "model") && input.model !== null && (typeof input.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(input.model))) throw httpError(400, "Turbo 模型无效");
  if (Object.hasOwn(input, "reasoningEffort") && !TURBO_REASONING_MODES.includes(input.reasoningEffort)) throw httpError(400, "Turbo 推理强度无效");
  if (Object.hasOwn(input, "fast") && typeof input.fast !== "boolean") throw httpError(400, "Turbo 推理速度设置必须是布尔值");
  if (Object.hasOwn(input, "millionContext") && typeof input.millionContext !== "boolean") throw httpError(400, "Turbo 百万上下文设置必须是布尔值");
  if (Object.hasOwn(input, "autoDisableGlobalRouting") && typeof input.autoDisableGlobalRouting !== "boolean") throw httpError(400, "Turbo 自动关闭全局路由设置必须是布尔值");
  if (Object.hasOwn(input, "accessMode") && !TURBO_ACCESS_MODES.includes(input.accessMode)) throw httpError(400, "Turbo 访问权限无效");
  if (Object.hasOwn(input, "deviceIds") && (!Array.isArray(input.deviceIds) || input.deviceIds.length > 32 || input.deviceIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)))) throw httpError(400, "Turbo 设备范围无效");
  if (Object.hasOwn(input, "requestId") && (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId))) throw httpError(400, "Turbo 请求标识无效");
  const change = {};
  for (const key of TURBO_POLICY_FIELDS) if (Object.hasOwn(input, key)) change[key] = key === "deviceIds" ? [...new Set(input[key])] : input[key];
  return Object.freeze(change);
}

function peerFailureMessage(error) {
  const messages = {
    TURBO_PEER_REJECTED: "设备拒绝了 Turbo 设置，请检查该设备支持的模型与推理强度",
    TURBO_PEER_BUSY: "设备正在保存或同步 Turbo 设置，请稍后重试",
    TURBO_PEER_RESPONSE_INVALID: "设备返回的 Turbo 确认不完整或无效，请更新设备后重试",
    TURBO_PEER_UNREACHABLE: "设备暂时不可达，Turbo 设置未同步"
  };
  return messages[error?.code] || "Turbo 设置同步失败，请检查设备连接后重试";
}

export class TurboCoordinator {
  constructor({ localService, peerAdapters = [], localNode, routingService = null } = {}) {
    this.localService = localService;
    this.peerAdapters = peerAdapters;
    this.localNode = localNode;
    this.routingService = routingService;
    this.lastNodes = [];
    this.operationQueue = Promise.resolve();
    this.pendingOperations = 0;
  }

  read() {
    const policy = this.localService.snapshot();
    return Object.freeze({ ...projectPolicy(policy), active: policy.active === true, modelEfforts: policy.modelEfforts || [], modelOptions: policy.modelOptions || [], devices: policy.devices || [], updatedAt: policy.updatedAt, nodes: Object.freeze([...this.lastNodes]) });
  }

  async setEnabled(enabled) {
    return this.sync({ enabled });
  }

  async update(change) {
    return this.sync(change);
  }

  runOperation(action) {
    this.pendingOperations += 1;
    const result = this.operationQueue.then(action).finally(() => { this.pendingOperations -= 1; });
    this.operationQueue = result.catch(() => {});
    return result;
  }

  save(change) {
    return this.runOperation(() => this.saveLocal(change));
  }

  async receive(change) {
    if (this.pendingOperations > 0) throw Object.assign(httpError(409, "本机正在保存或同步 Turbo 设置，请稍后重试"), { code: "TURBO_PEER_BUSY" });
    return this.runOperation(() => this.saveLocal(change));
  }

  async saveLocal(change) {
    const local = await this.localService.update(validateTurboChange(change, { allowRequestId: false }));
    const effectivePolicy = projectPolicy(local);
    if (effectivePolicy.enabled && effectivePolicy.autoDisableGlobalRouting) await this.routingService?.setEnabled?.(false);
    const localResult = { id: this.localNode?.id || "local", name: this.localNode?.name || "本机", status: "applied", policy: effectivePolicy };
    this.lastNodes = Object.freeze([Object.freeze(localResult)]);
    return Object.freeze({ ...effectivePolicy, operation: "save", updatedAt: local.updatedAt, converged: true, nodes: this.lastNodes });
  }

  sync(change) {
    return this.runOperation(() => this.syncAll(change));
  }

  async syncAll(change) {
    const local = await this.saveLocal(change);
    const effectivePolicy = projectPolicy(local);
    const remoteResults = await Promise.all(this.peerAdapters.map(async (peer) => {
      const identity = { id: peer.peer.id, name: peer.peer.name };
      try {
        const result = await peer.updateTurbo(effectivePolicy);
        const policy = projectPolicy(result);
        const mismatchedFields = TURBO_POLICY_FIELDS.filter((key) => JSON.stringify(policy[key]) !== JSON.stringify(effectivePolicy[key]));
        return { ...identity, status: mismatchedFields.length ? "mismatch" : "applied", policy, transport: result.transport,
          ...(mismatchedFields.length ? { message: "设备返回的 Turbo 设置与本机不一致，请重试同步", mismatchedFields } : {}) };
      } catch (error) {
        return { ...identity, status: "error", policy: null, message: peerFailureMessage(error) };
      }
    }));
    this.lastNodes = Object.freeze([...local.nodes, ...remoteResults.map(Object.freeze)]);
    return Object.freeze({ ...effectivePolicy, operation: "sync", updatedAt: local.updatedAt,
      converged: remoteResults.every((item) => item.status === "applied"), nodes: this.lastNodes });
  }
}
