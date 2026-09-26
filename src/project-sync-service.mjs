import crypto from 'node:crypto';
import { syncError, syncSelection, syncSnapshot, syncToken, syncProjects, sameSyncVersion } from './project-sync-contract.mjs';

export class ProjectSyncService {
  constructor({ localAdapter, localDevice, peers = [], now = Date.now, ttlMs = 10 * 60_000 } = {}) {
    this.sources = [{ device: { id: localDevice.id, name: localDevice.name, kind: 'local-codex' }, adapter: localAdapter },
      ...peers.map(adapter => ({ device: { id: adapter.peer.id, name: adapter.peer.name, kind: 'remote-codex' }, adapter }))];
    Object.assign(this, { now, ttlMs });
    this.preflights = new Map();
    this.pendingPreflights = 0;
  }

  adapter(selection) {
    const result = this.sources.find(source => source.device.id === selection.deviceId)?.adapter;
    if (!result) throw syncError('该设备未配置项目同步', 404);
    return result;
  }

  async catalog() {
    const devices = await Promise.all(this.sources.map(async ({ device, adapter }) => {
      try { return { device, status: 'connected', projects: syncProjects(await adapter.catalog()) }; }
      catch (error) { return { device, status: 'offline', projects: [], message: error.statusCode ? error.message : '设备离线、原生项目目录不可读或尚未升级项目同步功能' }; }
    }));
    return { schemaVersion: 1, devices };
  }

  prune() {
    for (const [token, record] of this.preflights) if (record.expiresAt <= this.now()) this.preflights.delete(token);
  }

  async preflight(input = {}) {
    this.prune();
    if (this.preflights.size + this.pendingPreflights >= 32 || this.pendingPreflights >= 4) {
      throw syncError('待确认或正在检查的同步过多，请稍后重新检查', 429);
    }
    this.pendingPreflights++;
    try { return await this.prepareSelection(input); }
    finally { this.pendingPreflights--; }
  }

  async prepareSelection(input) {
    const sourceSelection = syncSelection(input.source), targetSelection = syncSelection(input.target);
    if (sourceSelection.deviceId === targetSelection.deviceId) throw syncError('请选择不同设备上的项目', 400);
    const sourceAdapter = this.adapter(sourceSelection), targetAdapter = this.adapter(targetSelection);
    const [sourceRaw, targetRaw] = await Promise.all([
      sourceAdapter.inspect({ path: sourceSelection.path }), targetAdapter.inspect({ path: targetSelection.path })
    ]);
    const source = syncSnapshot(sourceRaw, sourceSelection), target = syncSnapshot(targetRaw, targetSelection);
    if (source.branch !== target.branch) throw syncError('两端分支不同，请先在目标设备选择相同分支');
    let targetToken = null;
    const unchanged = source.head === target.head;
    if (!unchanged) {
      const package_ = await sourceAdapter.export({ path: source.path, expected: source });
      if (package_?.head !== source.head || package_?.branch !== source.branch) throw syncError('源项目已变化，请重新检查');
      const prepared = await targetAdapter.prepare({ path: target.path, expected: target, package: package_ });
      if (!sameSyncVersion(syncSnapshot(prepared?.target, targetSelection), target)
        || prepared?.source?.head !== source.head || prepared?.source?.branch !== source.branch || prepared.unchanged !== false) {
        throw syncError('目标设备未确认预检结果，请重新检查');
      }
      targetToken = syncToken(prepared.token);
      const current = syncSnapshot(await sourceAdapter.inspect({ path: source.path }), sourceSelection);
      if (!sameSyncVersion(current, source)) throw syncError('源项目在预检期间发生变化，请重新检查');
    }
    const token = crypto.randomBytes(32).toString('hex'), expiresAt = this.now() + this.ttlMs;
    this.preflights.set(token, { source, target, sourceAdapter, targetAdapter, targetToken, unchanged, expiresAt });
    return { token, source, target, unchanged, expiresAt: new Date(expiresAt).toISOString() };
  }

  async execute(input = {}) {
    const token = syncToken(input.token), record = this.preflights.get(token);
    this.preflights.delete(token);
    if (!record || record.expiresAt <= this.now()) throw syncError('同步预检已使用或过期，请重新检查');
    const { source, target, sourceAdapter, targetAdapter, unchanged } = record;
    const current = syncSnapshot(await sourceAdapter.inspect({ path: source.path }), source);
    if (!sameSyncVersion(current, source)) throw syncError('源项目已变化，请重新检查');
    const result = unchanged
      ? { verified: true, unchanged: true, target: await targetAdapter.inspect({ path: target.path }) }
      : await targetAdapter.apply({ token: record.targetToken });
    const verified = syncSnapshot(result?.target, target);
    if (result?.verified !== true || result.unchanged !== unchanged || verified.head !== source.head || verified.branch !== source.branch) {
      throw syncError('目标设备尚未确认同步结果，请重新检查，勿重复执行');
    }
    return { verified: true, unchanged, target: verified };
  }
}
