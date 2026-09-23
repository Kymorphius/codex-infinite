export function createNativeChecklistTodoMutations({ readThreadId, readItems, enqueue, replaceText }) {
  function current(id, threadId, text) {
    if (!threadId || readThreadId() !== threadId) return null;
    return readItems().find(item => item.id === id && item.text === text && !item.done && item.assignedThreadId === threadId) || null;
  }
  return {
    edit(id, threadId, text, nextText) {
      const item = current(id, threadId, text), value = String(nextText || '').trim();
      if (!item || !value || value.length > 5000) return false;
      const input = Array.isArray(item.input) ? replaceText(item.input, value) : [{ type: 'text', text: value }];
      if (!input) return false;
      return enqueue('upsert', { ...item, text: value, input });
    },
    delete(id, threadId, text) {
      const item = current(id, threadId, text);
      if (!item) return false;
      return enqueue('delete', item);
    },
    exists: (id, threadId, text) => Boolean(current(id, threadId, text))
  };
}
