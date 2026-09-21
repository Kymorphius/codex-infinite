const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assignedChecklistTasksForThread(items, threadId) {
  const normalizedThreadId = String(threadId || '').trim().toLowerCase();
  if (!THREAD_ID.test(normalizedThreadId) || !Array.isArray(items)) return [];
  return items
    .filter(item => item && item.done === false && String(item.assignedThreadId || '').trim().toLowerCase() === normalizedThreadId)
    .map(item => ({ id: String(item.id || ''), text: String(item.text || '').trim() }))
    .filter(item => /^[a-zA-Z0-9-]{1,100}$/.test(item.id) && item.text)
    .slice(0, 100);
}
