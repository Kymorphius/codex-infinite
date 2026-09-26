import { checklistTimeMetadata } from './project-checklist-time.mjs';
import { normalizeChecklistInput } from './project-checklist-input.mjs';
import { validateTaskMetadata } from './task-center-contract.mjs';

export function normalizeChecklistAction(value) {
  if (!value || typeof value.projectKey !== 'string' || !value.projectKey.trim() || value.projectKey.length > 1000) throw Error('无效项目');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id)) throw Error('无效任务');
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.requestId)) throw Error('无效请求');
  if (!['upsert', 'delete'].includes(value.type)) throw Error('无效操作');
  if (value.type === 'upsert' && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 5000 || typeof value.done !== 'boolean')) throw Error('任务内容无效');
  const assignedThreadId = value.assignedThreadId == null || value.assignedThreadId === '' ? null : String(value.assignedThreadId).toLowerCase();
  if (assignedThreadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assignedThreadId)) throw Error('无效会话');
  const time = {};
  if (Object.prototype.hasOwnProperty.call(value, 'createdAt')) {
    const { createdAt } = checklistTimeMetadata({ createdAt: value.createdAt });
    if (value.createdAt !== null && createdAt === null) throw Error('无效加入时间');
    time.createdAt = createdAt;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'createdAtEstimated')) {
    if (typeof value.createdAtEstimated !== 'boolean') throw Error('无效加入时间标记');
    time.createdAtEstimated = value.createdAtEstimated;
  }
  const input = Object.prototype.hasOwnProperty.call(value, 'input') ? { input: normalizeChecklistInput(value.input) } : {};
  const creation = {};
  if (Object.hasOwn(value, 'creation')) {
    if (typeof value.creation !== 'boolean') throw Error('无效新任务标记');
    creation.creation = value.creation;
  }
  return { projectKey: value.projectKey, id: value.id, requestId: value.requestId, type: value.type, text: value.text?.trim(), done: value.done, assignedThreadId, ...time, ...input, ...creation, ...validateTaskMetadata(value) };
}
