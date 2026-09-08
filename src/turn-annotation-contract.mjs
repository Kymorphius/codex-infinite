export function annotationId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
}
export function normalizeAnnotationAction(value) {
  const threadId = annotationId(value?.threadId), turnId = annotationId(value?.turnId);
  if (!threadId || !turnId || typeof value.text !== 'string' || value.text.length > 20000 || !/^[a-z0-9-]{1,80}$/i.test(value.requestId || '')) throw Error('无效批注内容');
  return { threadId, turnId, text: value.text, requestId: value.requestId };
}
export function normalizeAnnotationDocument(value) {
  if (value?.version !== 1 || !value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes)) throw Error('批注文件格式异常');
  const notes = {};
  for (const [turnId, note] of Object.entries(value.notes)) {
    if (!annotationId(turnId) || typeof note?.text !== 'string' || note.text.length > 20000 || typeof note.updatedAt !== 'string') throw Error('批注文件格式异常');
    notes[turnId] = { text: note.text, updatedAt: note.updatedAt };
  }
  return { version: 1, notes };
}
