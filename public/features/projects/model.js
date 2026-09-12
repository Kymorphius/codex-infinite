const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export const projectIdentity = (deviceId, itemKey) => JSON.stringify([deviceId, itemKey]);
export const sectionIdentity = (deviceId, sectionId) => JSON.stringify([deviceId, sectionId]);
export const sourceLabel = source => source === 'chatgpt' ? 'ChatGPT' : 'Codex';

export function validateCatalogPayload(payload) {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.devices)
    || payload.devices.some(owner => !owner?.device?.id || !['connected', 'loading', 'offline'].includes(owner.status)
      || (owner.status === 'connected' && !owner.snapshot)
      || (owner.snapshot && (owner.snapshot.schemaVersion !== 1 || !Array.isArray(owner.snapshot.projects) || !Array.isArray(owner.snapshot.sections)
        || owner.snapshot.projects.some(project => typeof project.key !== 'string' || typeof project.name !== 'string'
          || !Array.isArray(project.sourceDirectories) || project.sourceDirectories.some(path => typeof path !== 'string') || !Array.isArray(project.conversationKeys))
        || owner.snapshot.sections.some(section => typeof section.id !== 'string' || !Array.isArray(section.itemKeys)))))) {
    throw Error('项目列表格式无效，请刷新重试');
  }
  return payload;
}

export function projectCatalog(payload, { stale = false } = {}) {
  const devices = payload?.devices || [], projects = [], sections = [];
  for (const owner of devices) {
    const snapshot = owner.snapshot;
    if (!snapshot) continue;
    const sectionRows = snapshot.sections || [];
    for (const section of sectionRows) if (section.kind !== 'tasks') {
      sections.push({ ...section, filterId: sectionIdentity(owner.device.id, section.id), deviceName: owner.device.name || owner.device.id });
    }
    const positions = new Map();
    for (const section of sectionRows) for (const key of section.itemKeys) if (!positions.has(key)) positions.set(key, positions.size);
    for (const [catalogIndex, project] of snapshot.projects.entries()) {
      const memberships = sectionRows.filter(section => section.itemKeys.includes(project.key));
      const section = memberships.find(section => section.kind === 'pinned') || memberships[0] || null;
      projects.push({ ...project, identity: projectIdentity(owner.device.id, project.key), deviceId: owner.device.id,
        deviceName: owner.device.name || owner.device.id, deviceKind: owner.device.kind, status: owner.status,
        stale: stale || owner.status !== 'connected', revision: snapshot.revision, capabilities: snapshot.capabilities || [],
        sections: sectionRows, section, memberships, pinned: memberships.some(value => value.kind === 'pinned'),
        conversationCount: project.childrenLoaded ? project.conversationKeys.length : null,
        nativeOrder: positions.has(project.key) ? positions.get(project.key) : positions.size + catalogIndex });
    }
  }
  return { projects, devices, sections };
}

export function filterProjects(projects, filters = {}) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  const rows = projects.filter(project => (!query || [project.name, ...project.sourceDirectories].some(value => value.toLocaleLowerCase().includes(query)))
    && (!filters.device || project.deviceId === filters.device)
    && (!filters.source || project.source === filters.source)
    && (!filters.section || project.memberships.some(section => sectionIdentity(project.deviceId, section.id) === filters.section)));
  if (filters.sort === 'name') return rows.sort((a, b) => collator.compare(a.name, b.name));
  if (filters.sort === 'pinned') return rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || collator.compare(a.name, b.name));
  const deviceOrder = new Map(projects.map(project => [project.deviceId, 0]));
  [...deviceOrder.keys()].forEach((id, index) => deviceOrder.set(id, index));
  return rows.sort((a, b) => deviceOrder.get(a.deviceId) - deviceOrder.get(b.deviceId) || a.nativeOrder - b.nativeOrder);
}

export function actionReason(project, action) {
  if (project.stale || project.status !== 'connected') return '当前为缓存记录，请等待所属设备连接并刷新后操作';
  if (!/^[0-9a-f]{64}$/.test(project.revision || '')) return '所属设备未提供有效版本，请刷新后操作';
  if (!project.section) return '项目尚未映射到原生分区，请在所属设备查看';
  if (!project.capabilities.includes(action)) return action === 'item-move'
    ? '所属设备暂未开放置顶和移动，请在原生侧边栏管理' : '所属设备暂不支持从此页面打开项目';
  return '';
}

export function moveTargets(project) {
  return project.sections.filter(section => section.kind !== 'tasks' && section.id !== project.section?.id);
}

export function pinTarget(project) {
  return project.sections.find(section => section.kind === (project.pinned ? 'projects' : 'pinned')) || null;
}

export function projectAction(project, action, targetSectionId) {
  const reason = actionReason(project, action);
  if (reason) throw Error(reason);
  if (action !== 'open' && action !== 'item-move') throw Error('不支持此项目操作');
  if (action === 'item-move' && !moveTargets(project).some(section => section.id === targetSectionId)) throw Error('目标分区不可用，请刷新后重试');
  return { action, deviceId: project.deviceId, itemKey: project.key, sectionId: project.section.id,
    expectedRevision: project.revision, ...(action === 'item-move' ? { targetSectionId } : {}) };
}
