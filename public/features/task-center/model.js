const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export const PAGE_SIZE = 50;
export const DEVICE_LABELS = { connected: '在线', loading: '连接中', offline: '离线', unsupported: '待升级' };
export const DELIVERY_REVIEW_MESSAGE = '这项任务的交付结果待核对。请核对目标会话是否已收到；核对完成前暂停修改，避免重复发送。';

export function validateCatalog(data) {
  if (data?.version !== 1 || !data.localDeviceId || !Array.isArray(data.devices)) throw Error('任务目录格式无效，请刷新后重试。');
  const devices = new Set(), keys = new Set();
  for (const entry of data.devices) {
    if (!entry?.device?.id || devices.has(entry.device.id) || !DEVICE_LABELS[entry.status] || !Array.isArray(entry.items)) throw Error('设备任务目录格式无效。');
    devices.add(entry.device.id);
    for (const item of entry.items) {
      if (!item.key || keys.has(item.key) || item.ownerDeviceId !== entry.device.id || !item.id
        || !['checklist', 'dispatch'].includes(item.source) || typeof item.text !== 'string') throw Error('任务来源无效，请刷新后重试。');
      keys.add(item.key);
    }
  }
  return data;
}

export function itemStatus(item) {
  if (item.deliveryReservation) return 'review';
  if (item.source === 'dispatch') return item.status || item.dispatchStatus || 'unknown';
  return item.done ? 'done' : item.executionState === 'delivered' ? 'delivered' : item.assignedThreadId ? 'assigned' : 'inbox';
}

export function statusLabel(item) {
  return ({ inbox: '待领取', assigned: '会话待办 · 暂停', review: '待核对', delivered: '已交付', done: '已完成', backlog: '待办 · 暂停',
    scheduled: '已排期', queued: '排队中', sending: '发送中', sent: '已发送', failed: '发送失败', cancelled: '已取消', delivery_unknown: '发送待核对' })[itemStatus(item)] || '状态未知';
}

export function catalogRows(catalog) {
  return (catalog?.devices || []).flatMap(entry => entry.items
    .filter(item => item.source !== 'dispatch' || item.ownerDeviceId !== catalog.localDeviceId)
    .map(item => ({ ...item, deviceName: entry.device.name || entry.device.id, connected: entry.status === 'connected', deviceStatus: entry.status })))
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0) || a.key.localeCompare(b.key));
}

export function filterRows(rows, { device = '', query = '', status = '' } = {}) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return rows.filter(item => (!device || item.ownerDeviceId === device) && (!status || itemStatus(item) === status)
    && (!needle || [item.text, item.deviceName, item.scopeName, item.assignedThreadTitle].some(value => String(value || '').toLocaleLowerCase('zh-CN').includes(needle))));
}

export const sessionKey = task => JSON.stringify([task.provider ?? 'codex', task.device?.id, task.id]);

export function taskDestination(item) {
  return { provider: item.deliveryReservation?.assignedProvider ?? item.assignedProvider ?? 'codex', deviceId: item.deliveryReservation?.assignedDeviceId || item.assignedDeviceId || item.ownerDeviceId,
    threadId: item.deliveryReservation?.assignedThreadId || item.assignedThreadId };
}

export function assignmentTargets(tasks = [], catalog) {
  const devices = new Map((catalog?.devices || []).map(entry => [entry.device.id, entry]));
  const seen = new Set();
  return tasks.filter(task => {
    const device = devices.get(task.device?.id);
    if (!['codex', 'terminal'].includes(task.provider ?? 'codex') || task.archived || !uuidPattern.test(task.id || '') || !device || device.status !== 'connected'
      || (task.device.status && task.device.status !== 'connected') || seen.has(sessionKey(task))) return false;
    seen.add(sessionKey(task)); return true;
  }).map(task => ({ ...task, key: sessionKey(task), deviceName: devices.get(task.device.id).device.name || task.device.id }));
}

export function matchesTaskDestination(task, destination) {
  return task.id === destination.threadId && task.device?.id === destination.deviceId && (task.provider ?? 'codex') === destination.provider;
}

export function actionIssue(item, type, stale = false) {
  if (item?.deliveryReservation) return DELIVERY_REVIEW_MESSAGE;
  if (stale) return '列表需要刷新后才能修改。';
  if (!item?.connected) return '来源设备暂不可用，请连接后刷新。';
  if (item.source !== 'checklist') return '请在来源设备管理排期任务。';
  if (!item.revision) return '任务版本缺失，请刷新。';
  if (item.executionState === 'delivered' && ['assign', 'return'].includes(type)) return '任务已经交付；退回或重派不会撤销真实发送队列，请前往会话处理。';
  return '';
}
