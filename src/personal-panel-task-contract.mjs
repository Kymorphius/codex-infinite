const LANES = new Set(['todo', 'doing', 'paused', 'done', 'cancelled', 'review']);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value);

export function normalizePersonalPanelTaskList(value) {
  if (value?.version !== 1 || !validId(value.owner?.accountId) || !validId(value.owner?.spaceId) || !Array.isArray(value.tasks) || value.tasks.length > 100) throw new Error('Personal Panel 返回了无效任务快照');
  const owner = { accountId: value.owner.accountId, spaceId: value.owner.spaceId };
  const tasks = value.tasks.map(task => {
    if (!validId(task?.id) || typeof task.name !== 'string' || task.name.length > 500 || typeof task.status !== 'string' || task.status.length > 100 || !LANES.has(task.lane)) throw new Error('Personal Panel 返回了无效任务');
    return { id: task.id, name: task.name, status: task.status, lane: task.lane, category: typeof task.category === 'string' ? task.category.slice(0, 100) : '', planDate: Number.isSafeInteger(task.planDate) ? task.planDate : null, readOnly: task.readOnly === true, revision: /^[a-f0-9]{64}$/i.test(task.revision || '') ? task.revision : null };
  });
  return { owner, tasks, nextCursor: typeof value.nextCursor === 'string' ? value.nextCursor : null };
}

export function personalPanelTaskMutation(snapshot, input) {
  const task = snapshot.tasks.find(item => item.id === input?.id);
  if (!task || task.readOnly || !task.revision || task.lane === 'review' || task.lane === 'cancelled') throw new Error('任务不可操作，请刷新后核对原生状态');
  if (input.revision !== task.revision || input.owner?.accountId !== snapshot.owner.accountId || input.owner?.spaceId !== snapshot.owner.spaceId) throw new Error('任务状态已变化，请刷新后重试');
  if (input.action === 'complete') return { op: 'task.complete', owner: snapshot.owner, id: task.id, revision: task.revision };
  const status = { start: '进行中', pause: '暂停', todo: '待办' }[input.action];
  if (!status || task.lane === 'done') throw new Error('此状态不能这样修改');
  return { op: 'task.update', owner: snapshot.owner, id: task.id, revision: task.revision, patch: { status } };
}
