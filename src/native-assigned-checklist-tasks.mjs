export function normalizeAssignedChecklistTasks(items) {
  return Array.isArray(items) ? items.filter((item) => item && /^[a-zA-Z0-9-]{1,100}$/.test(String(item.id || '')) && typeof item.text === 'string' && item.text.trim()).slice(0, 100).map((item) => ({ id: String(item.id), text: item.text.trim() })) : [];
}

export function appendAssignedChecklistTaskRows(list, items, createRow, makeButton, busy, resume) {
  items.forEach((item) => list.append(createRow('任务·已领取·暂停', item.text, [makeButton('恢复发送', () => resume(item), busy), makeButton('查看综合清单', () => window.__cccProjectChecklist?.openGeneral?.(), busy)])));
}

export async function resumeAssignedTask(task, context) {
  if (context.busy() || !task?.id || !task.text) return;
  context.setBusy(true);
  try {
    await context.request('thread/queue/add', { threadId: context.threadId, input: [{ type: 'text', text: task.text }], clientUserMessageId: crypto.randomUUID() });
    window.__cccProjectChecklist?.completeAssignedTask?.(task.id);
    context.removeAssigned(task.id); context.setServerItems(await context.listQueue(context.threadId)); context.setWarning('');
  } catch (error) { context.setWarning(error.message || '无法恢复已领取任务'); }
  finally { context.setBusy(false); }
}

export function updateHeldQueueShell(toolbar, panel, queued, held, assigned, warning, open) {
  const text = '待办 ' + (queued.length + held.length + assigned.length), warningState = warning ? 'true' : 'false', hidden = !open;
  if (toolbar.textContent !== text) toolbar.textContent = text;
  if (toolbar.dataset.warning !== warningState) toolbar.dataset.warning = warningState;
  if (panel.hidden !== hidden) panel.hidden = hidden;
}
