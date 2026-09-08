export async function readProjectSearchThreads(client) {
  const tasks = [], seen = new Set();
  let cursor = null;
  do {
    const page = await client.request('thread/list', {
      cursor, limit: 100, archived: false, sourceKinds: [], sortKey: 'updated_at'
    });
    if (!Array.isArray(page?.data)) throw new Error('invalid project search thread list');
    for (const thread of page.data) {
      tasks.push({ id: thread.id, projectId: thread.projectId, cwd: thread.cwd,
        title: thread.name || thread.preview || '未命名会话', archived: thread.archived });
    }
    cursor = page.nextCursor || null;
    if (cursor && seen.has(cursor)) throw new Error('repeated project search thread cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return tasks;
}
