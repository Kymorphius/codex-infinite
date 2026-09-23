export function focusNativeChecklistTask(list, taskId) {
  const target = Array.from(list.querySelectorAll('[data-checklist-task-id]')).find(row => row.dataset.checklistTaskId === taskId);
  if (!target) return false;
  target.scrollIntoView({ block: 'center' });
  target.querySelector('textarea,button')?.focus({ preventScroll: true });
  return true;
}

export function openNativeChecklistReassignPicker(list, taskId) {
  const row = Array.from(list.querySelectorAll('[data-checklist-task-id]')).find(node => node.dataset.checklistTaskId === taskId);
  const button = Array.from(row?.querySelectorAll('button') || []).find(node => node.textContent === '改派会话' && !node.disabled);
  if (!button) return false;
  row.scrollIntoView({ block: 'center' });
  button.click();
  return true;
}

export function createNativeChecklistReassignController({ readThreadId, readItems, openGeneral, getLoaded, isOpen, list, warn, render }) {
  let pending = null;
  return {
    open(id, threadId, text) {
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id || '') || readThreadId() !== threadId || !readItems().some(item => item.id === id && item.text === text && !item.done && item.assignedThreadId === threadId)) return false;
      pending = { id, threadId, text };
      openGeneral();
      if (pending && isOpen() && getLoaded()) render();
      return true;
    },
    afterRender() {
      if (!pending || !isOpen() || !getLoaded()) return;
      const request = pending; pending = null;
      if (readThreadId() !== request.threadId || !readItems().some(item => item.id === request.id && item.text === request.text && !item.done && item.assignedThreadId === request.threadId)
        || !openNativeChecklistReassignPicker(list, request.id)) warn('任务归属已变化，请同步后重试');
    }
  };
}

export function openNativeChecklistTask(taskId, restoreWorkspace) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(taskId)) return false;
  if (typeof window.__cccProjectChecklist?.openGeneral !== 'function') return false;
  restoreWorkspace();
  window.__cccProjectChecklist.openGeneral(taskId);
  return true;
}
