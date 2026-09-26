// Verification is acknowledged by the source before native queue submission.
export function createChecklistDeliveryBridge({ readItems, enqueue, signal }) {
  const awaiting = new Map();
  function settle(id, error, item) {
    const waiter = awaiting.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer); awaiting.delete(id);
    if (error) waiter.reject(typeof error === 'string' ? new Error(error) : Object.assign(new Error(error.message), error)); else waiter.resolve(item);
  }
  function submit(item, request, type) {
    const requestId = enqueue(item, request, type);
    if (!requestId) return Promise.reject(new Error('无法保存任务核对请求'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(requestId, '任务来源核对尚未确认，请稍后再试'), 90000);
      awaiting.set(requestId, { resolve, reject, timer }); signal();
    });
  }
  return {
    prepare(id, threadId, text, request, expectedRevision) {
      const item = readItems().find(value => value.id === id && (text === null || value.text === text) && !value.done && value.executionState !== 'delivered' && value.assignedThreadId === threadId);
      if (!item || item.readOnly) return Promise.reject(new Error(item?.attachmentError || '任务来源未连接或状态已变化，请刷新后重试'));
      if (!item.sourceRef) return Promise.reject(new Error('任务尚未保存到来源设备，请同步后再入队'));
      if (expectedRevision && item.expectedRevision !== expectedRevision) return Promise.reject(Object.assign(new Error('任务状态已变化，请刷新后领取'), { code: 'REVISION_CONFLICT' }));
      return submit(item, request, 'verify-delivery');
    },
    release(id, reservation, requestId) {
      const item = readItems().find(value => value.id === id);
      if (!item) return Promise.reject(new Error('任务来源尚未就绪，预占结果待核对'));
      return submit({ ...item, ...reservation }, requestId, 'release-delivery');
    },
    accept(result) {
      for (const id of result.acknowledged || []) settle(id, null, result.actionResults?.find(value => value.requestId === id)?.item);
      for (const id of result.rejected || []) settle(id, result.rejectionErrors?.find(value => value.requestId === id) || result.error || '任务来源核对失败');
    },
    dispose() { for (const id of awaiting.keys()) settle(id, '任务清单已更新，请重新入队'); }
  };
}
