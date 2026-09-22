export function normalizeAssignedChecklistTasks(items) {
  return Array.isArray(items) ? items.filter((item) => item && /^[a-zA-Z0-9-]{1,100}$/.test(String(item.id || '')) && typeof item.text === 'string' && item.text.trim()).slice(0, 100).map((item) => ({ id: String(item.id), text: item.text.trim() })) : [];
}

// Self-contained apart from normalization, so the same state contract runs in
// the injected renderer and in deterministic navigation-race tests.
export function createAssignedChecklistState(readThreadId) {
  let snapshot = { threadId: null, items: [] };
  const forThread = (id) => id && id === readThreadId() && id === snapshot.threadId ? snapshot.items : [];
  return {
    forThread,
    clear() { snapshot = { threadId: null, items: [] }; },
    publish(value) {
      if (!value || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.threadId || '') || value.threadId !== readThreadId()) return false;
      const next = { threadId: value.threadId, items: normalizeAssignedChecklistTasks(value.items) };
      if (JSON.stringify(next) === JSON.stringify(snapshot)) return false;
      snapshot = next; return true;
    },
    owns(id, task) { return forThread(id).some(item => item.id === task?.id && item.text === task.text); },
    remove(id, taskId) { if (snapshot.threadId === id) snapshot.items = snapshot.items.filter(item => item.id !== taskId); }
  };
}

export function appendAssignedChecklistTaskRows(list, items, createRow, makeButton, busy, returnTask, resume) {
  items.forEach((item) => list.append(createRow('待办·暂停', item.text, [makeButton('恢复', () => resume(item), busy), makeButton('退回', () => returnTask(item), busy)])));
}

export async function resumeAssignedTask(task, context) {
  if (context.busy() || !task?.id || !task.text || !context.isCurrent() || !context.ownsTask(task)) return;
  context.setBusy(true);
  try {
    await context.request('thread/queue/add', { threadId: context.threadId, input: [{ type: 'text', text: task.text }], clientUserMessageId: crypto.randomUUID() });
    window.__cccProjectChecklist?.completeAssignedTask?.(task.id, context.threadId, task.text);
    context.removeAssigned(task.id);
    if (context.isCurrent()) {
      const items = await context.listQueue(context.threadId);
      if (context.isCurrent()) { context.setServerItems(items); context.setWarning(''); }
    }
  } catch (error) { if (context.isCurrent()) context.setWarning(error.message || '无法恢复已领取任务'); }
  finally { context.setBusy(false); }
}

export function updateHeldQueueShell(toolbar, panel, queued, held, assigned, warning, open) {
  const text = '待办 ' + (queued.length + held.length + assigned.length), warningState = warning ? 'true' : 'false', hidden = !open;
  if (toolbar.textContent !== text) toolbar.textContent = text;
  if (toolbar.dataset.warning !== warningState) toolbar.dataset.warning = warningState;
  if (panel.hidden !== hidden) panel.hidden = hidden;
}
