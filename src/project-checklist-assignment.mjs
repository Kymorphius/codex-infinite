const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assignedChecklistTasksForThread(items, threadId) {
  const normalizedThreadId = String(threadId || '').trim().toLowerCase();
  if (!THREAD_ID.test(normalizedThreadId) || !Array.isArray(items)) return [];
  return items
    .filter(item => item && (item.assignedProvider ?? 'codex') === 'codex' && item.done === false && item.executionState !== 'delivered' && String(item.assignedThreadId || '').trim().toLowerCase() === normalizedThreadId)
    .map(item => ({ id: String(item.id || ''), text: String(item.text || '').trim(), ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}), ...(Array.isArray(item.input) ? { input: item.input } : {}), ...(item.sourceRef ? { sourceRef: item.sourceRef, expectedRevision: item.expectedRevision, readOnly: item.readOnly, sourceConnected: item.sourceConnected, ...(item.deliveryReservation ? { deliveryReservation: item.deliveryReservation } : {}), ...(item.attachmentError ? { attachmentError: item.attachmentError } : {}) } : {}) }))
    .filter(item => /^[a-zA-Z0-9-]{1,100}$/.test(item.id) && item.text)
    .slice(0, 100);
}
