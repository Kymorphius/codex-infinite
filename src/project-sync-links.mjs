import { randomUUID } from 'node:crypto';
import { sameSyncVersion, syncError, syncSnapshot } from './project-sync-contract.mjs';

export function assertSyncIdentity(current, expected) {
  if (Boolean(current.identitySupported) !== Boolean(expected.identitySupported)
    || current.sharedProjectId !== expected.sharedProjectId) throw syncError('项目关联已变化，请刷新后重新预检');
}

export function assertCompatibleIdentity(source, target) {
  if (source.sharedProjectId && target.sharedProjectId && source.sharedProjectId !== target.sharedProjectId) {
    throw syncError('两端属于不同的共享项目，请先解除误关联，再重新预检');
  }
}

export async function linkProjectCopies(record) {
  const { source, target, sourceAdapter, targetAdapter } = record;
  if (!source.identitySupported || !target.identitySupported) throw syncError('两端都需要升级到支持项目关联的控制台');
  assertCompatibleIdentity(source, target);
  const ends = [{ expected: source, adapter: sourceAdapter }, { expected: target, adapter: targetAdapter }]
    .sort((a, b) => JSON.stringify([a.expected.deviceId, a.expected.path]).localeCompare(JSON.stringify([b.expected.deviceId, b.expected.path]), 'en'));
  for (const { expected, adapter } of ends) {
    const current = syncSnapshot(await adapter.inspect({ path: expected.path }), expected);
    if (!sameSyncVersion(current, expected)) throw syncError('项目版本已变化，请重新预检');
    assertSyncIdentity(current, expected);
  }
  const projectId = source.sharedProjectId || target.sharedProjectId || randomUUID();
  try {
    for (const { expected, adapter } of ends) {
      const result = await adapter.associate({ path: expected.path, expected, projectId });
      if (result?.projectId !== projectId || result.path !== expected.path) throw Error('unconfirmed mapping');
    }
    for (const { expected, adapter } of ends) {
      const current = syncSnapshot(await adapter.inspect({ path: expected.path }), expected);
      if (current.sharedProjectId !== projectId || !sameSyncVersion(current, expected)) throw Error('unconfirmed readback');
    }
  } catch {
    throw syncError('关联未完整确认，可能只保存了一端。请刷新并重新预检，沿用已有关联完成另一端；不会自动重试或撤销', 503);
  }
  return { linked: true, projectId };
}
