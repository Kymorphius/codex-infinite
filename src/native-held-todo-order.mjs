export function readNativeTodoOrder(storage, key, threadId) {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}')?.[threadId];
    return Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id)).slice(0, 300) : [];
  } catch { return []; }
}

export function writeNativeTodoOrder(storage, key, threadId, ids) {
  const all = JSON.parse(storage.getItem(key) || '{}');
  if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('排序记录无效');
  all[threadId] = ids.slice(0, 300);
  storage.setItem(key, JSON.stringify(all));
}

export function moveNativeTodoEntry(entries, id, offset) {
  const ids = entries.map(entry => entry.item.id), index = ids.indexOf(id), next = index + offset;
  if (index < 0 || next < 0 || next >= ids.length || (offset !== -1 && offset !== 1)) return null;
  [ids[index], ids[next]] = [ids[next], ids[index]];
  return ids;
}

export function bootstrapNativeTodoOrder(storage, key, threadId, held, assigned) {
  let order = readNativeTodoOrder(storage, key, threadId);
  if (!order.length && held.some((item, index) => index && item.heldAt < held[index - 1].heldAt)) {
    order = [...held.map(item => item.id), ...assigned.map(item => item.id)];
    try { writeNativeTodoOrder(storage, key, threadId, order); } catch { /* preserve in-session order */ }
  }
  return order;
}
