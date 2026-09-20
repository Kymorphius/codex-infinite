const text = (value, limit = 240) => typeof value === 'string' ? value.slice(0, limit) : '';
export function normalizeExperimentItems(items) {
  if (!Array.isArray(items) || items.length > 2000) throw new Error('Invalid experiment inventory');
  return items.map(item => {
    if (!item || typeof item.name !== 'string' || typeof item.enabled !== 'boolean') throw new Error('Invalid experiment item');
    return { name: text(item.name, 120), title: text(item.displayName || item.title || item.name),
      description: text(item.description, 1000), stage: text(item.stage, 60), enabled: item.enabled };
  });
}
export function normalizeExperimentSnapshot(value) {
  const groups = {};
  for (const key of ['native', 'console']) {
    const group = value?.[key];
    groups[key] = group?.status === 'connected'
      ? { status: 'connected', items: normalizeExperimentItems(group.items) }
      : { status: 'unavailable', items: [], message: key === 'native' ? '原生实验功能暂时无法读取' : '控制台扩展暂时无法读取' };
  }
  return { observedAt: typeof value?.observedAt === 'string' && Number.isFinite(Date.parse(value.observedAt)) ? value.observedAt : null, ...groups };
}
