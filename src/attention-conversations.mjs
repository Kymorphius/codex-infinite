const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function projectAttentionConversations(tasks = [], unreadIds = []) {
  const unread = new Set(unreadIds.filter(id => typeof id === 'string').map(id => id.toLowerCase()));
  const unique = new Map();
  for (const task of tasks) {
    const id = String(task?.id || '').toLowerCase();
    if (!ID.test(id) || task.archived || unique.has(id)) continue;
    const section = task.latestInputSource === 'codex' ? 'codex' : task.status === 'active' ? 'active' : task.status === 'completed' && unread.has(id) ? 'review' : null;
    if (!section) continue;
    unique.set(id, { id, section, title: String(task.title || '未命名会话').slice(0, 160),
      projectLabel: String(task.projectDisplayName || task.project || '未归类').slice(0, 80),
      updatedAt: typeof task.updatedAt === 'string' ? task.updatedAt : '' });
  }
  return [...unique.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}
