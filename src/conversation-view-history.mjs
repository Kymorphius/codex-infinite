// Pure, bounded local-task viewing policy; storage and DOM remain in the adapter.
export function createConversationViewHistory(saved = []) {
  const validId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const clean = (value, limit) => String(value || '').slice(0, limit);
  let entries = [];
  function sorted() { return [...entries].sort((a, b) => b.viewedAt - a.viewedAt || a.id.localeCompare(b.id)); }
  for (const item of Array.isArray(saved) ? saved : []) {
    if (!validId(item?.id) || !Number.isFinite(item.viewedAt) || item.viewedAt <= 0) continue;
    const id = item.id.toLowerCase();
    if (entries.some(entry => entry.id === id)) continue;
    entries.push({ id, title: clean(item.title, 160), projectLabel: clean(item.projectLabel, 80), viewedAt: item.viewedAt, revision: item.revision == null ? null : clean(item.revision, 100) });
  }
  entries = sorted().slice(0, 200);
  return {
    list: sorted,
    view(task, now, current) {
      if (!validId(task?.id) || !Number.isFinite(now) || now <= 0) return false;
      const id = task.id.toLowerCase(), previous = entries.find(entry => entry.id === id);
      entries = entries.filter(entry => entry.id !== id);
      entries.unshift({ id, title: clean(task.title || current?.title || previous?.title || '未命名会话', 160),
        projectLabel: clean(current?.projectLabel || previous?.projectLabel || '', 80),
        viewedAt: now, revision: current ? clean(current.updatedAt, 100) : null });
      entries = entries.slice(0, 200); return true;
    },
    hasViewed(item) {
      const entry = entries.find(entry => entry.id === item.id?.toLowerCase());
      if (!entry) return false;
      if (entry.revision !== null && entry.revision === String(item.updatedAt || '')) return true;
      const updated = Date.parse(item.updatedAt);
      return Number.isFinite(updated) && updated <= entry.viewedAt;
    }
  };
}
