const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const headPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;

export const projectKey = project => JSON.stringify([project.deviceId, project.path]);

export function validateCatalog(payload) {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.devices)) throw Error('项目列表格式无效，请刷新重试');
  const ids = new Set();
  for (const owner of payload.devices) {
    if (!nonempty(owner?.device?.id) || ids.has(owner.device.id)
      || !['connected', 'offline'].includes(owner.status) || !Array.isArray(owner.projects)) throw Error('设备项目列表格式无效');
    ids.add(owner.device.id);
    if (owner.projects.some(project => !nonempty(project?.path) || !nonempty(project?.name))) throw Error('设备项目路径格式无效');
  }
  return payload;
}

export function catalogProjects(catalog) {
  return (catalog?.devices || []).flatMap(owner => owner.projects.map(project => ({
    ...project, deviceId: owner.device.id, deviceName: owner.device.name || owner.device.id,
    connected: owner.status === 'connected', key: projectKey({ deviceId: owner.device.id, path: project.path })
  })));
}

export const selectionInput = project => ({ deviceId: project.deviceId, path: project.path });

export function selectionIssue(source, target, stale) {
  if (stale) return '项目列表需要刷新后才能预检';
  if (!source || !target) return '请选择源项目和目标项目';
  if (!source.connected || !target.connected) return '所选设备暂不可用，请连接后刷新';
  if (source.deviceId === target.deviceId) return '请选择不同设备上的项目';
  return '';
}

function validSnapshot(snapshot, expected) {
  return snapshot?.deviceId === expected.deviceId && snapshot?.path === expected.path
    && nonempty(snapshot.branch) && headPattern.test(snapshot.head) && snapshot.clean === true;
}

export function validatePreflight(payload, source, target, now = Date.now()) {
  if (!validSnapshot(payload?.source, source) || !validSnapshot(payload?.target, target)
    || payload.source.branch !== payload.target.branch || !nonempty(payload.token)
    || typeof payload.unchanged !== 'boolean' || payload.unchanged !== (payload.source.head === payload.target.head)) {
    throw Error('预检结果不完整或方向不一致，请重新预检');
  }
  const expiry = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) throw Error('预检已过期，请重新预检');
  return { token: payload.token, source: payload.source, target: payload.target, unchanged: payload.unchanged, expiresAt: payload.expiresAt };
}

export function validateExecution(payload, preflight) {
  if (payload?.verified !== true || !validSnapshot(payload.target, preflight.target)
    || payload.target.head !== preflight.source.head || payload.target.branch !== preflight.source.branch
    || typeof payload.unchanged !== 'boolean') {
    throw Error('目标设备尚未确认完整同步结果，请刷新并重新预检核对');
  }
  return { verified: true, unchanged: payload.unchanged, target: payload.target };
}
