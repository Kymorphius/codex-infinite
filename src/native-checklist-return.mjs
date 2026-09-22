// Self-contained functions shared by the injected UI and behavioral tests.
export function createChecklistReturnBridge({ readItems, readThreadId, enqueue }) {
  const awaiting = new Map();
  function settle(requestId, error) {
    const waiter = awaiting.get(requestId);
    if (!waiter) return;
    awaiting.delete(requestId); clearTimeout(waiter.timer);
    if (error) waiter.reject(new Error(error)); else waiter.resolve(true);
  }
  return {
    async returnAssignedTask(id, threadId, text) {
      if (!threadId || readThreadId() !== threadId) throw new Error('会话已切换，请在任务所属会话中退回');
      const item = readItems().find(value => value.id === id && value.text === text && !value.done && value.assignedThreadId === threadId);
      if (!item) throw new Error('任务状态已变化，请同步后重试');
      const action = { projectKey: 'ccc:general-inbox:v1', type: 'upsert', id: item.id, text: item.text, done: false, assignedThreadId: null, requestId: crypto.randomUUID() };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(action.requestId, '退回尚未确认，操作已保留并会自动重试'), 8000);
        awaiting.set(action.requestId, { resolve, reject, timer });
        try { enqueue(action); } catch (error) { settle(action.requestId, error.message || '无法保存退回操作'); }
      });
    },
    accept(result) {
      for (const id of result.acknowledged || []) settle(id);
      if (result.error) for (const id of awaiting.keys()) settle(id, '退回保存失败，操作已保留并会自动重试');
    },
    dispose() { for (const id of awaiting.keys()) settle(id, '清单已更新，退回操作将继续同步'); }
  };
}

export async function returnAssignedTodo(task, context) {
  if (context.busy() || !task?.id || !task.text || !context.isCurrent()) return;
  context.setBusy(true);
  try {
    const bridge = window.__cccProjectChecklist;
    if (typeof bridge?.returnAssignedTask !== 'function') throw new Error('任务清单尚未就绪，请稍后重试');
    await bridge.returnAssignedTask(task.id, context.threadId, task.text);
    if (context.isCurrent()) context.setWarning('');
  } catch (error) { if (context.isCurrent()) context.setWarning(error.message || '退回失败，请稍后重试'); }
  finally { context.setBusy(false); }
}
