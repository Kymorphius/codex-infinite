export function appendNativeHeldTodoRows(list, entries, createRow, createEditRow, makeButton, context) {
  entries.forEach(({ source, item, index }) => {
    const actions = [];
    if (source === 'held' && context.editing?.id === item.id) {
      const edit = createEditRow('待办', item, context.editing.value || '', [
        makeButton('保存', () => context.save(item), context.busy), makeButton('取消', context.cancel, context.busy)
      ], () => { if (context.editing?.id === item.id) context.editing.value = edit.editor.value; });
      list.append(edit.row);
      queueMicrotask(() => edit.editor.focus());
      return;
    }
    if (source === 'held') {
      actions.push(makeButton('编辑', () => context.edit(item), context.busy));
      actions.push(makeButton('上移', () => context.move(index, -1), context.busy || context.timeView || index === 0));
      actions.push(makeButton('下移', () => context.move(index, 1), context.busy || context.timeView || index === context.heldCount - 1));
    }
    actions.push(makeButton('恢复', () => context.resume(source, item), context.busy));
    if (source === 'assigned') actions.push(makeButton('重派', () => context.reassign(item), context.busy), makeButton('退回', () => context.returnTask(item), context.busy));
    else actions.push(makeButton('删除', () => context.remove(item), context.busy));
    list.append(createRow('待办', source === 'assigned' ? item.text : item.summary || context.summarize(item.input), actions, source === 'held' ? item.heldAt : Date.parse(item.createdAt)));
  });
}

export function orderNativeHeldTodoEntries(held, assigned, view) {
  const entries = [...held.map((item, index) => ({ source: 'held', item, index })), ...assigned.map((item, index) => ({ source: 'assigned', item, index }))];
  if (view !== 'time') return entries;
  const time = entry => entry.source === 'held' ? entry.item.heldAt : Date.parse(entry.item.createdAt);
  return entries.sort((a, b) => (Number.isFinite(time(a)) ? time(a) : Infinity) - (Number.isFinite(time(b)) ? time(b) : Infinity));
}
