import { createHash } from 'node:crypto';
import { normalizeChecklistInput, taskInputAfterTextEdit } from './project-checklist-input.mjs';

const ID = /^[a-zA-Z0-9-]{1,100}$/;
const DEVICE = /^[a-zA-Z0-9:._-]{1,200}$/;
const HASH = /^[0-9a-f]{64}$/;
const THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TASK_PROVIDERS = Object.freeze(['codex', 'terminal']);
export function taskProvider(value = 'codex') {
  if (!TASK_PROVIDERS.includes(value)) throw taskCenterError('INVALID_PROVIDER', '无效会话类型');
  return value;
}
export const TASK_CENTER_ACTIONS = Object.freeze(['create', 'edit', 'assign', 'return', 'complete', 'reopen', 'delete', 'delivered', 'verify-delivery', 'release-delivery']);
export const GENERAL_TASK_SCOPE_ID = createHash('sha256').update('ccc:general-inbox:v1').digest('hex');

export function taskCenterError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
export function taskRevision(item) { return createHash('sha256').update(JSON.stringify(canonical(item))).digest('hex'); }
export function taskKey(ownerDeviceId, scopeId, id) { return JSON.stringify([ownerDeviceId, scopeId, id]); }
export function validateTaskScopeId(scopeId) {
  if (typeof scopeId !== 'string' || !HASH.test(scopeId)) throw taskCenterError('INVALID_SCOPE', '无效任务清单');
  return scopeId;
}
export function validateTaskMetadata(value) {
  const result = {};
  if (Object.hasOwn(value, 'assignedProvider')) result.assignedProvider = value.assignedProvider === null ? null : taskProvider(value.assignedProvider);
  if (Object.hasOwn(value, 'assignedDeviceId')) {
    if (value.assignedDeviceId !== null && (typeof value.assignedDeviceId !== 'string' || !DEVICE.test(value.assignedDeviceId))) throw taskCenterError('INVALID_DEVICE', '无效任务设备');
    result.assignedDeviceId = value.assignedDeviceId;
  }
  if (Object.hasOwn(value, 'executionState')) {
    if (value.executionState !== null && value.executionState !== 'delivered') throw taskCenterError('INVALID_EXECUTION_STATE', '无效任务交付状态');
    result.executionState = value.executionState;
  }
  if (Object.hasOwn(value, 'deliveryReservation')) {
    const reservation = value.deliveryReservation;
    if (reservation !== null && (!reservation || typeof reservation !== 'object' || typeof reservation.token !== 'string' || !THREAD.test(reservation.token) ||
      typeof reservation.requestId !== 'string' || !ID.test(reservation.requestId) || typeof reservation.assignedDeviceId !== 'string' || !DEVICE.test(reservation.assignedDeviceId) ||
      (reservation.assignedThreadId !== null && (typeof reservation.assignedThreadId !== 'string' || !THREAD.test(reservation.assignedThreadId))) ||
      Object.keys(reservation).some(key => !['token', 'requestId', 'assignedDeviceId', 'assignedThreadId', 'assignedProvider', 'createdAt'].includes(key)) ||
      typeof reservation.createdAt !== 'string' || !Number.isFinite(Date.parse(reservation.createdAt)))) throw taskCenterError('INVALID_RESERVATION', '无效任务交付预占');
    result.deliveryReservation = reservation === null ? null : { ...reservation, assignedProvider: taskProvider(reservation.assignedProvider) };
  }
  return result;
}
export function normalizeTaskCenterAction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw taskCenterError('INVALID_ACTION', '无效任务操作');
  if (!TASK_CENTER_ACTIONS.includes(value.type)) throw taskCenterError('INVALID_ACTION', '无效任务操作');
  if (typeof value.ownerDeviceId !== 'string' || !DEVICE.test(value.ownerDeviceId)) throw taskCenterError('INVALID_DEVICE', '无效任务来源设备');
  if (typeof value.id !== 'string' || !ID.test(value.id)) throw taskCenterError('INVALID_ID', '无效任务');
  if (typeof value.requestId !== 'string' || !ID.test(value.requestId)) throw taskCenterError('INVALID_REQUEST', '无效请求');
  const scopeId = validateTaskScopeId(value.scopeId ?? (value.type === 'create' ? GENERAL_TASK_SCOPE_ID : null));
  if (value.type === 'create' && scopeId !== GENERAL_TASK_SCOPE_ID) throw taskCenterError('INVALID_SCOPE', '新任务须保存到综合清单');
  const expectedRevision = value.expectedRevision ?? null;
  if (value.type === 'create' ? expectedRevision !== null : typeof expectedRevision !== 'string' || !HASH.test(expectedRevision)) throw taskCenterError('INVALID_REVISION', '任务版本无效，请刷新后重试');
  const action = { ownerDeviceId: value.ownerDeviceId, scopeId, id: value.id, requestId: value.requestId, expectedRevision, type: value.type };
  validateTaskMetadata(value);
  if (Object.hasOwn(value, 'done') && typeof value.done !== 'boolean') throw taskCenterError('INVALID_STATE', '任务完成状态无效');
  if (value.type === 'create' || value.type === 'edit' || (['assign', 'delivered'].includes(value.type) && Object.hasOwn(value, 'text'))) {
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 5000) throw taskCenterError('INVALID_TEXT', '任务内容无效');
    action.text = value.text.trim();
    if (Object.hasOwn(value, 'input')) action.input = normalizeChecklistInput(value.input);
  } else if (Object.hasOwn(value, 'input')) throw taskCenterError('INVALID_INPUT', '修改附件时须提供完整任务内容');
  if (value.type === 'assign' || value.type === 'verify-delivery' || (value.type === 'delivered' && (Object.hasOwn(value, 'assignedDeviceId') || Object.hasOwn(value, 'assignedThreadId')))) {
    if (typeof value.assignedDeviceId !== 'string' || !DEVICE.test(value.assignedDeviceId)) throw taskCenterError('INVALID_DEVICE', '无效目标设备');
    if (!(value.type === 'verify-delivery' && value.assignedThreadId === null) && (typeof value.assignedThreadId !== 'string' || !THREAD.test(value.assignedThreadId))) throw taskCenterError('INVALID_THREAD', '无效目标会话');
    action.assignedProvider = taskProvider(value.assignedProvider);
    action.assignedDeviceId = value.assignedDeviceId;
    action.assignedThreadId = value.assignedThreadId?.toLowerCase() || null;
  }
  if (value.type === 'delivered' || value.type === 'release-delivery') {
    if (typeof value.reservationToken !== 'string' || !THREAD.test(value.reservationToken)) throw taskCenterError('INVALID_RESERVATION', '交付确认缺少预占凭证');
    action.reservationToken = value.reservationToken;
  }
  return action;
}

export function changeTaskItem(previous, action, now) {
  const item = previous ? { ...previous, updatedAt: now } : { id: action.id, text: action.text, done: false, assignedThreadId: null, assignedDeviceId: null, assignedProvider: null, executionState: null, createdAt: now, createdAtEstimated: false, updatedAt: now };
  if (Object.hasOwn(action, 'text')) {
    item.text = action.text;
    const input = action.input || previous?.input;
    if (input) item.input = taskInputAfterTextEdit(input, null, action.text);
  }
  if (action.assignedThreadId) Object.assign(item, { assignedProvider: taskProvider(action.assignedProvider), assignedDeviceId: action.assignedDeviceId, assignedThreadId: action.assignedThreadId, executionState: null, done: false });
  if (action.type === 'return') Object.assign(item, { assignedProvider: null, assignedDeviceId: null, assignedThreadId: null, executionState: null, done: false });
  if (action.type === 'complete') item.done = true;
  if (action.type === 'reopen') Object.assign(item, { done: false, executionState: null });
  if (action.type === 'release-delivery') delete item.deliveryReservation;
  if (action.type === 'delivered') {
    if (!item.assignedThreadId) throw taskCenterError('TASK_NOT_ASSIGNED', '任务尚未指派，不能标记交付', 409);
    Object.assign(item, { executionState: 'delivered', done: false });
    delete item.deliveryReservation;
  }
  return item;
}

export function taskCenterChecklistItem(item, ownerDeviceId, scopeId) {
  return {
    key: taskKey(ownerDeviceId, scopeId, item.id), ownerDeviceId, scopeId, id: item.id, source: 'checklist',
    text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null,
    assignedProvider: item.assignedThreadId ? taskProvider(item.assignedProvider ?? 'codex') : null,
    assignedDeviceId: item.assignedThreadId ? item.assignedDeviceId || ownerDeviceId : null,
    executionState: item.executionState || null, createdAt: item.createdAt || null, updatedAt: item.updatedAt || null,
    revision: taskRevision(item), attachmentCount: (item.input || []).filter(part => part.type !== 'text').length,
    ...(item.deliveryReservation ? { deliveryReservation: { ...item.deliveryReservation, assignedProvider: taskProvider(item.deliveryReservation.assignedProvider) } } : {}),
    ...(item.input ? { input: item.input } : {})
  };
}
