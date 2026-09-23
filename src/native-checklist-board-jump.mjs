export function focusNativeChecklistTask(list, taskId) {
  const target = Array.from(list.querySelectorAll('[data-checklist-task-id]')).find(row => row.dataset.checklistTaskId === taskId);
  if (!target) return false;
  target.scrollIntoView({ block: 'center' });
  target.querySelector('textarea,button')?.focus({ preventScroll: true });
  return true;
}

export function openNativeChecklistTask(taskId, restoreWorkspace) {
  if (typeof taskId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(taskId)) return false;
  if (typeof window.__cccProjectChecklist?.openGeneral !== 'function') return false;
  restoreWorkspace();
  window.__cccProjectChecklist.openGeneral(taskId);
  return true;
}
