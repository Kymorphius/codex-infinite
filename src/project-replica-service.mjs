import { randomUUID } from 'node:crypto';
import { ProjectSyncService } from './project-sync-service.mjs';
import { syncSelection, syncSnapshot, sameSyncVersion, syncToken, syncError } from './project-sync-contract.mjs';

export class ProjectReplicaService extends ProjectSyncService {
  #creates = new Map();
  #pending = 0;
  async createOptions({ deviceId } = {}) {
    const adapter = this.adapter(syncSelection({ deviceId, path: '/' }));
    if (typeof adapter.createOptions !== 'function') throw syncError('目标设备需要升级新副本功能', 503);
    const result = await adapter.createOptions();
    if (!Array.isArray(result?.roots) || result.roots.length > 100 || result.roots.some(root => typeof root !== 'string' || !root || root.length > 4096 || /[\0\r\n]/.test(root))) throw syncError('目标创建目录不可确认');
    const recoveries = result.recoveries || [];
    if (!Array.isArray(recoveries) || recoveries.length > 100 || recoveries.some(item => !/^[a-f0-9-]{36}$/.test(item.operationId || '') || typeof item.path !== 'string' || item.path.length > 4096 || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(item.head || ''))) throw syncError('目标恢复记录不可确认');
    return { roots: result.roots, recoveries };
  }
  async createPreflight({ source: selected, deviceId, parent, name } = {}) {
    for (const [token, record] of this.#creates) if (record.expiresAt <= this.now()) this.#creates.delete(token);
    if (this.#creates.size + this.#pending >= 32 || this.#pending >= 4) throw syncError('创建预检过多，请稍后重试', 429);
    this.#pending++;
    try {
      const selection = syncSelection(selected), targetSelection = syncSelection({ deviceId, path: parent });
      if (selection.deviceId === deviceId) throw syncError('请选择另一台目标设备', 400);
      const sourceAdapter = this.adapter(selection), targetAdapter = this.adapter(targetSelection);
      await this.createOptions({ deviceId });
      const source = syncSnapshot(await sourceAdapter.inspect({ path: selection.path }), selection);
      const pkg = await sourceAdapter.export({ path: source.path, expected: source });
      if (pkg.head !== source.head || pkg.branch !== source.branch) throw syncError('源版本已变化');
      const prepared = await targetAdapter.createPrepare({ parent, name, package: pkg });
      if (prepared?.head !== source.head || prepared.branch !== source.branch) throw syncError('目标未确认创建版本');
      const target = syncSelection({ deviceId, path: prepared.path });
      const targetToken = syncToken(prepared.token);
      if (!sameSyncVersion(syncSnapshot(await sourceAdapter.inspect({ path: source.path }), selection), source)) throw syncError('源版本已变化');
      const token = randomUUID(), expiresAt = this.now() + this.ttlMs;
      this.#creates.set(token, { source, target, sourceAdapter, targetAdapter, targetToken, expiresAt });
      return { token, source, target, expiresAt: new Date(expiresAt).toISOString() };
    } finally { this.#pending--; }
  }
  async createExecute({ token } = {}) {
    syncToken(token); const record = this.#creates.get(token); this.#creates.delete(token);
    if (!record || record.expiresAt <= this.now()) throw syncError('创建预检已过期或使用');
    const { source, target, sourceAdapter, targetAdapter, targetToken } = record;
    if (!sameSyncVersion(syncSnapshot(await sourceAdapter.inspect({ path: source.path }), source), source)) throw syncError('源版本已变化，请重新预检');
    const result = await targetAdapter.createApply({ token: targetToken });
    if (result?.verified === false && result.path === target.path && typeof result.operationId === 'string') return { verified: false, target, operationId: result.operationId, message: result.message };
    const verified = syncSnapshot(result?.target, target);
    if (result.verified !== true || verified.head !== source.head || verified.branch !== source.branch) throw syncError('副本创建结果未确认，请刷新核对，勿重复执行');
    const readback = syncSnapshot(await targetAdapter.inspect({ path: target.path }), target);
    if (!sameSyncVersion(readback, verified)) throw syncError('新副本读回发生变化，请在目标设备核对');
    return { verified: true, target: readback, operationId: result.operationId };
  }
  async createResume({ deviceId, operationId } = {}) {
    const adapter = this.adapter(syncSelection({ deviceId, path: '/' }));
    const result = await adapter.createResume({ operationId });
    if (result?.verified !== true || result.operationId !== operationId) throw syncError('登记结果未确认，请核对目标设备');
    const target = syncSnapshot(result.target, syncSelection({ deviceId, path: result.target?.path }));
    const readback = syncSnapshot(await adapter.inspect({ path: target.path }), target);
    if (!sameSyncVersion(readback, target)) throw syncError('登记后的副本版本已变化');
    return { verified: true, operationId, target: readback };
  }

}
