import { SKILL_SCHEMA_VERSION, normalizeSkillHash, normalizeSkillLocator } from "./skill-contract.mjs";

const DEVICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function deviceId(value) {
  const id = String(value || "");
  if (!DEVICE_PATTERN.test(id)) throw new Error("设备标识无效");
  return id;
}

export class SkillSyncService {
  constructor({ localAdapter, peerAdapters = [], localNode } = {}) {
    this.localAdapter = localAdapter;
    this.peerAdapters = peerAdapters;
    this.localNode = localNode;
  }

  peer(id) { return this.peerAdapters.find((adapter) => adapter.peer?.id === id) || null; }

  async catalog() {
    const local = await this.localAdapter.list();
    const peers = await Promise.all(this.peerAdapters.map((adapter) => adapter.listSkills()));
    return {
      status: "ok",
      schemaVersion: SKILL_SCHEMA_VERSION,
      devices: [
        { status: "connected", device: this.localNode, schemaVersion: SKILL_SCHEMA_VERSION, skills: local.skills },
        ...peers
      ]
    };
  }

  async sync(input = {}) {
    const sourceDeviceId = deviceId(input.sourceDeviceId);
    const { scope, sourceId, name } = normalizeSkillLocator(input);
    const sourceHash = normalizeSkillHash(input.sourceHash);
    if (!Array.isArray(input.targetDeviceIds) || !input.targetDeviceIds.length || input.targetDeviceIds.length > 16) throw new Error("请选择同步目标设备");
    const targetIds = [...new Set(input.targetDeviceIds.map(deviceId))].filter((id) => id !== sourceDeviceId);
    if (!targetIds.length) throw new Error("请选择其他设备作为同步目标");
    const source = sourceDeviceId === this.localNode.id ? this.localAdapter : this.peer(sourceDeviceId);
    if (!source) throw new Error("来源设备不存在");
    const package_ = sourceDeviceId === this.localNode.id
      ? await this.localAdapter.export(scope, name, sourceId)
      : await source.exportSkill(scope, name, sourceId);
    if (package_.hash !== sourceHash) {
      const error = new Error("来源 Skill 已发生变化，请刷新后重试");
      error.statusCode = 409;
      throw error;
    }
    const catalog = await this.catalog();
    const results = await Promise.all(targetIds.map(async (targetId) => {
      const targetCatalog = catalog.devices.find((entry) => entry.device?.id === targetId);
      const existing = targetCatalog?.skills?.find((skill) => skill.scope === package_.scope && skill.name === name);
      if (!targetCatalog || targetCatalog.status !== "connected") return { deviceId: targetId, status: "error", message: targetCatalog?.message || "目标设备不可达" };
      try {
        const result = targetId === this.localNode.id
          ? await this.localAdapter.install({ package: package_, expectedCurrentHash: existing?.hash || null })
          : await this.peer(targetId)?.installSkill(package_, existing?.hash || null);
        if (!result) throw new Error("目标设备不存在");
        return { deviceId: targetId, status: result.unchanged ? "unchanged" : "applied", hash: result.hash, backupCreated: result.backupCreated };
      } catch (error) {
        return { deviceId: targetId, status: "error", message: error.message };
      }
    }));
    return { sourceDeviceId, scope, sourceId, installedScope: package_.scope, name, hash: sourceHash, converged: results.every((result) => result.status !== "error"), results };
  }

  async toggle(input = {}) {
    const sourceDeviceId = deviceId(input.sourceDeviceId);
    const locator = normalizeSkillLocator(input);
    if (typeof input.enabled !== "boolean") throw new Error("Skill 开关状态无效");
    const owner = sourceDeviceId === this.localNode.id ? this.localAdapter : this.peer(sourceDeviceId);
    if (!owner) throw new Error("Skill 所属设备不存在");
    const result = sourceDeviceId === this.localNode.id
      ? await this.localAdapter.setEnabled({ ...locator, enabled: input.enabled })
      : await owner.toggleSkill({ ...locator, enabled: input.enabled });
    return { sourceDeviceId, ...locator, accepted: true, enabled: result.enabled, restartRequired: result.restartRequired !== false };
  }
}
