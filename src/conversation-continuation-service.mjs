import { randomUUID } from 'node:crypto';
import { ProjectReplicaService } from './project-replica-service.mjs';
import { syncSelection, syncSnapshot, sameSyncVersion, syncToken, syncError } from './project-sync-contract.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function sameProject(a, b) {
  if (!a.sharedProjectId || a.sharedProjectId !== b.sharedProjectId) throw syncError('请先在项目同步页关联这两个副本');
  if (a.head !== b.head || a.branch !== b.branch) throw syncError('请先将两个项目同步到相同代码版本');
}
function unchanged(current, expected) {
  if (!sameSyncVersion(current, expected) || current.sharedProjectId !== expected.sharedProjectId) throw syncError('项目版本或关联已变化，请重新预检');
}
function threadId(value) { if (!UUID.test(value || '')) throw syncError('会话标识无效', 400); return value; }

export class ConversationContinuationService extends ProjectReplicaService {
  #permits = new Map();
  #pending = 0;
  async conversationOperations({ deviceId } = {}) {
    const adapter = this.adapter(syncSelection({ deviceId, path: '/' }));
    const result = await adapter.conversationOperations();
    if (!Array.isArray(result?.operations) || result.operations.length > 100) throw syncError('会话恢复记录不可确认');
    return { operations: result.operations.map(item => ({ operationId: threadId(item.operationId), sourceThreadId: threadId(item.sourceThreadId), path: syncSelection({ deviceId, path: item.path }).path, title: String(item.title || '').slice(0, 160), note: String(item.note || '').slice(0, 2000), status: ['prepared', 'needs-review', 'completed'].includes(item.status) ? item.status : 'needs-review', resumeEligible: item.resumeEligible === true })) };
  }
  async conversationList({ source } = {}) {
    const selection = syncSelection(source);
    const result = await this.adapter(selection).conversationList({ path: selection.path });
    if (!Array.isArray(result?.conversations) || result.conversations.length > 1000) throw syncError('源设备会话清单不可确认');
    return { conversations: result.conversations.map(item => ({ threadId: threadId(item.threadId), title: String(item.title || '').slice(0, 160), status: String(item.status || ''), eligible: item.eligible === true, reason: String(item.reason || '').slice(0, 200) })) };
  }
  async conversationPreflight({ source: a, target: b, threadId: id, note = '' } = {}) {
    for (const [key, entry] of this.#permits) if (entry.expiresAt <= this.now()) this.#permits.delete(key);
    if (this.#permits.size + this.#pending >= 16 || this.#pending >= 2) throw syncError('会话复制预检过多，请稍后重试', 429);
    const sourceSelection = syncSelection(a), targetSelection = syncSelection(b); threadId(id);
    if (sourceSelection.deviceId === targetSelection.deviceId) throw syncError('请选择另一台目标设备', 400);
    if (typeof note !== 'string' || note.length > 2000 || /\0/.test(note)) throw syncError('交接说明须在 2000 字以内', 400);
    this.#pending++;
    try {
      const sourceAdapter = this.adapter(sourceSelection), targetAdapter = this.adapter(targetSelection);
      const source = syncSnapshot(await sourceAdapter.inspect({ path: a.path }), sourceSelection);
      const target = syncSnapshot(await targetAdapter.inspect({ path: b.path }), targetSelection); sameProject(source, target);
      const pkg = await sourceAdapter.conversationExport({ path: source.path, threadId: id });
      if (pkg?.threadId !== id || !/^[a-f0-9]{64}$/.test(pkg.sha256 || '') || !Number.isSafeInteger(pkg.bytes) || pkg.bytes <= 0 || pkg.bytes > 8 * 1024 * 1024) throw syncError('源设备未返回可确认的会话快照');
      const prepared = await targetAdapter.conversationPrepare({ path: target.path, expected: target, package: pkg, note });
      if (!UUID.test(prepared?.operationId || '') || prepared.path !== target.path) throw syncError('目标未确认会话预检');
      unchanged(syncSnapshot(await sourceAdapter.inspect({ path: source.path }), source), source);
      const token = randomUUID(), expiresAt = this.now() + this.ttlMs;
      this.#permits.set(token, { source, target, id, sha256: pkg.sha256, bytes: pkg.bytes, title: String(pkg.title || '').slice(0, 160), sourceAdapter, targetAdapter, operationId: prepared.operationId, expiresAt });
      return { token, source, target, operationId: prepared.operationId, expiresAt: new Date(expiresAt).toISOString(), thread: { threadId: id, title: pkg.title, sha256: pkg.sha256, bytes: pkg.bytes } };
    } finally { this.#pending--; }
  }
  async conversationExecute({ token } = {}) {
    let applyStarted;
    try {
      syncToken(token); const record = this.#permits.get(token); this.#permits.delete(token);
      if (!record) throw syncError('会话预检已过期或使用，请重新检查');
      applyStarted = false;
      if (record.expiresAt <= this.now()) throw syncError('会话预检已过期或使用，请重新检查');
      const { source, target, sourceAdapter, targetAdapter, operationId } = record;
      unchanged(syncSnapshot(await sourceAdapter.inspect({ path: source.path }), source), source);
      unchanged(syncSnapshot(await targetAdapter.inspect({ path: target.path }), target), target);
      const latest = await sourceAdapter.conversationExport({ path: source.path, threadId: record.id });
      if (latest.sha256 !== record.sha256 || latest.bytes !== record.bytes || latest.threadId !== record.id) throw syncError('源会话已变化，请重新预检');
      applyStarted = true;
      const result = await targetAdapter.conversationApply({ operationId, expected: target });
      return this.#result(result, { ...record, deviceId: target.deviceId });
    } catch (error) {
      error.details = typeof applyStarted === 'boolean' ? { applyStarted } : {};
      throw error;
    }
  }
  async conversationResume({ deviceId, operationId } = {}) {
    threadId(operationId);
    const selection = syncSelection({ deviceId, path: '/' }), adapter = this.adapter(selection);
    const result = await adapter.conversationResume({ operationId });
    return this.#result(result, { operationId, deviceId });
  }
  #result(result, expected) {
    if (result?.operationId !== expected.operationId) throw syncError('会话操作记录未确认');
    if (result.verified === false) return { verified: false, operationId: expected.operationId, message: String(result.message || '结果未知，请在目标设备核对').slice(0, 500) };
    threadId(result.targetThreadId); threadId(result.sourceThreadId);
    if (result.verified !== true || result.targetThreadId === result.sourceThreadId || (expected.id && result.sourceThreadId !== expected.id) || (expected.target && result.path !== expected.target.path)) throw syncError('目标会话独立读回未确认');
    return { verified: true, operationId: expected.operationId, targetThreadId: result.targetThreadId, sourceThreadId: result.sourceThreadId, path: result.path, title: result.title, note: result.note, target: syncSelection({ deviceId: expected.deviceId, path: result.path }) };
  }
}
