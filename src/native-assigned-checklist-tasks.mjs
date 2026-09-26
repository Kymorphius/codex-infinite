export function normalizeAssignedChecklistTasks(items) {
  return Array.isArray(items) ? items.filter((item) => item && item.executionState !== 'delivered' && /^[a-zA-Z0-9-]{1,100}$/.test(String(item.id || '')) && typeof item.text === 'string' && item.text.trim()).slice(0, 100).map((item) => ({ id: String(item.id), text: item.text.trim(), ...(typeof item.createdAt === 'string' ? { createdAt: item.createdAt } : {}), ...(Array.isArray(item.input) ? { input: item.input } : {}), ...(item.sourceRef ? { sourceRef: item.sourceRef, expectedRevision: item.expectedRevision, readOnly: item.readOnly, sourceConnected: item.sourceConnected, ...(item.deliveryReservation ? { deliveryReservation: item.deliveryReservation } : {}), ...(item.attachmentError ? { attachmentError: item.attachmentError } : {}) } : {}) })) : [];
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

export async function resumeAssignedTask(task, context) {
  if (context.busy() || !task?.id || !task.text || !context.isCurrent() || !context.ownsTask(task)) return;
  if (!context.deliveryLockHeld && typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('ccc-task-delivery:' + task.id, { ifAvailable: true }, lock => lock && resumeAssignedTask(task, { ...context, deliveryLockHeld: true }));
  context.setBusy(true);
  const bridge = window.__cccProjectChecklist, storage = typeof localStorage !== 'undefined' ? localStorage : window.localStorage;
  const key = 'ccc.checklist.delivery.v1:' + context.threadId + ':' + task.id;
  let receipt;
  try {
    receipt = storage ? JSON.parse(storage.getItem(key) || 'null') : null;
    if (receipt?.phase === 'releasing') {
      if (task.sourceConnected && !task.deliveryReservation && task.expectedRevision && ![receipt.expectedRevision, receipt.sourceRevisionBefore].includes(task.expectedRevision)) { storage.removeItem(key); receipt = null; }
      else if (task.sourceConnected && task.deliveryReservation?.token === receipt.reservationToken && bridge?.releaseAssignedTask) { await bridge.releaseAssignedTask(task.id, { expectedRevision: receipt.expectedRevision, reservationToken: receipt.reservationToken }, receipt.releaseRequestId); storage.removeItem(key); return; }
      else throw new Error('尚未发送消息，任务预占解除结果待核对');
    }
    if (receipt?.phase === 'queued' && receipt.reservationToken && task.sourceConnected && !task.deliveryReservation && task.expectedRevision && ![receipt.expectedRevision, receipt.sourceRevisionBefore].includes(task.expectedRevision)) { storage.removeItem(key); receipt = null; }
    const recoverable = receipt?.phase === 'verifying' && context.deliveryLockHeld;
    if (receipt && ((!recoverable && receipt.phase !== 'queued') || receipt.text !== task.text)) throw new Error('上次入队结果待核对，已阻止重复发送；请先查看发送队列');
    const ownsReservation = receipt && task.deliveryReservation?.requestId === receipt.clientUserMessageId;
    if (task.sourceConnected === false || (task.readOnly && !ownsReservation)) throw new Error(task.attachmentError || '任务来源设备未连接，请连接后入队');
    if (!receipt || recoverable) {
      if (task.sourceRef && (!storage || typeof bridge?.prepareAssignedTask !== 'function')) throw new Error('任务来源核对尚未就绪，请刷新后入队');
      const input = task.input ? await context.hydrateInput(task) : [{ type: 'text', text: task.text }];
      if (!context.isCurrent() || !context.ownsTask(task)) return;
      const clientUserMessageId = receipt?.clientUserMessageId || crypto.randomUUID();
      receipt ||= { phase: 'verifying', clientUserMessageId, text: task.text, expectedRevision: task.expectedRevision, sourceRevisionBefore: task.expectedRevision };
      storage?.setItem(key, JSON.stringify(receipt));
      const reserved = ownsReservation ? { revision: task.expectedRevision, deliveryReservation: task.deliveryReservation } : bridge?.prepareAssignedTask ? await bridge.prepareAssignedTask(task.id, context.threadId, task.text, clientUserMessageId) : null;
      if (task.sourceRef && !reserved?.deliveryReservation?.token) throw new Error('来源设备未确认任务预占，未发送消息');
      if (reserved) Object.assign(receipt, { expectedRevision: reserved.revision, reservationToken: reserved.deliveryReservation.token });
      if (!context.isCurrent() || !context.ownsTask(task)) {
        if (receipt.reservationToken && bridge?.releaseAssignedTask) { receipt.phase = 'releasing'; receipt.releaseRequestId = crypto.randomUUID(); storage?.setItem(key, JSON.stringify(receipt)); await bridge.releaseAssignedTask(task.id, { expectedRevision: receipt.expectedRevision, reservationToken: receipt.reservationToken }, receipt.releaseRequestId); storage?.removeItem(key); }
        return;
      }
      receipt.phase = 'submitting'; storage?.setItem(key, JSON.stringify(receipt));
      await context.request('thread/queue/add', { threadId: context.threadId, input, clientUserMessageId });
      receipt.phase = 'queued'; storage?.setItem(key, JSON.stringify(receipt));
    }
    if (bridge?.completeAssignedTask?.(task.id, context.threadId, task.text, ...(receipt.reservationToken ? [{ expectedRevision: receipt.expectedRevision, reservationToken: receipt.reservationToken }] : [])) !== true) {
      throw new Error('已加入发送队列，但任务状态未保存；请勿再次入队，稍后刷新任务清单');
    }
    context.removeAssigned(task.id);
    if (context.isCurrent()) {
      const items = await context.listQueue(context.threadId);
      if (context.isCurrent()) { context.setServerItems(items); context.setWarning(''); }
    }
  } catch (error) {
    if (receipt?.phase === 'verifying' && ['REVISION_CONFLICT', 'TASK_NOT_FOUND', 'TARGET_MISMATCH', 'TASK_NOT_PENDING', 'DELIVERY_RESERVED'].includes(error.code)) storage?.removeItem(key);
    if (context.isCurrent()) context.setWarning(error.message || '无法将任务加入发送队列');
  }
  finally { context.setBusy(false); }
}

export function updateHeldQueueShell(toolbar, panel, queued, held, assigned, warning, open) {
  const text = '待办 ' + (queued.length + held.length + assigned.length), warningState = warning ? 'true' : 'false', hidden = !open;
  if (toolbar.textContent !== text) toolbar.textContent = text;
  if (toolbar.dataset.warning !== warningState) toolbar.dataset.warning = warningState;
  if (panel.hidden !== hidden) panel.hidden = hidden;
}
