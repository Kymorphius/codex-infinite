export function appendNativeHeldTodoRows(list, entries, createRow, createEditRow, makeButton, context) {
  entries.forEach(({ source, item, index }, position) => {
    const actions = [];
    if (context.sorting) {
      actions.push(makeButton('上移', () => context.move(item.id, -1), context.busy || position === 0));
      actions.push(makeButton('下移', () => context.move(item.id, 1), context.busy || position === entries.length - 1));
      list.append(createRow('待办', source === 'assigned' ? item.text : item.summary || context.summarize(item.input), actions, source === 'held' ? item.heldAt : Date.parse(item.createdAt)));
      return;
    }
    if (context.editing?.id === item.id && (!context.editing.source || context.editing.source === source)) {
      const edit = createEditRow('待办', source === 'assigned' ? { ...item, heldAt: Date.parse(item.createdAt) } : item, context.editing.value || '', [
        makeButton('保存', () => context.save(item), context.busy), makeButton('取消', context.cancel, context.busy)
      ], () => { if (context.editing?.id === item.id) context.editing.value = edit.editor.value; });
      list.append(edit.row);
      queueMicrotask(() => edit.editor.focus());
      return;
    }
    actions.push(makeButton('编辑', () => context.edit(source, item), context.busy));
    actions.push(makeButton('加入发送队列', () => context.resume(source, item), context.busy));
    actions.push(makeButton('重派', () => context.reassign(source, item), context.busy));
    actions.push(makeButton('退回', () => context.returnTask(source, item), context.busy));
    actions.push(makeButton('删除', () => context.remove(source, item), context.busy));
    list.append(createRow('待办', source === 'assigned' ? item.text : item.summary || context.summarize(item.input), actions, source === 'held' ? item.heldAt : Date.parse(item.createdAt)));
  });
}

export function orderNativeHeldTodoEntries(held, assigned, view, manualIds = []) {
  const entries = [...held.map((item, index) => ({ source: 'held', item, index })), ...assigned.map((item, index) => ({ source: 'assigned', item, index }))];
  const time = entry => entry.source === 'held' ? entry.item.heldAt : Date.parse(entry.item.createdAt);
  entries.sort((a, b) => (Number.isFinite(time(a)) ? time(a) : Infinity) - (Number.isFinite(time(b)) ? time(b) : Infinity));
  if (view === 'time' || !manualIds.length) return entries;
  const rank = new Map(manualIds.map((id, index) => [id, index]));
  return entries.sort((a, b) => (rank.get(a.item.id) ?? Infinity) - (rank.get(b.item.id) ?? Infinity));
}
