export function readNativeChecklistHeldTodos(storage) {
  const threadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let records;
  try { records = JSON.parse(storage.getItem('codex-control-console.native-held-queue.v1') || '{}'); }
  catch { return []; }
  if (!records || typeof records !== 'object' || Array.isArray(records)) return [];
  const todos = [];
  for (const [threadId, items] of Object.entries(records)) {
    if (!threadIdPattern.test(threadId) || !Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object' || !threadIdPattern.test(String(item.id || '')) || !Number.isFinite(item.heldAt)) continue;
      const text = String(item.summary || '含附件或结构化内容的消息').replace(/\s+/g, ' ').trim().slice(0, 240);
      if (text) todos.push({ id: String(item.id).toLowerCase(), threadId: threadId.toLowerCase(), text, heldAt: item.heldAt, origin: item.origin === 'draft' ? '直存待办' : item.origin === 'paused-queue' ? '已暂停队列' : '会话待办' });
    }
  }
  return todos.sort((left, right) => left.heldAt - right.heldAt || left.id.localeCompare(right.id));
}
