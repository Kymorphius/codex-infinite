export function normalizeChecklistAction(value) {
  if (!value || typeof value.projectKey !== 'string' || !value.projectKey.trim() || value.projectKey.length > 1000) throw Error('无效项目');
  if (typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id)) throw Error('无效任务');
  if (typeof value.requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.requestId)) throw Error('无效请求');
  if (!['upsert', 'delete'].includes(value.type)) throw Error('无效操作');
  if (value.type === 'upsert' && (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 5000 || typeof value.done !== 'boolean')) throw Error('任务内容无效');
  return { projectKey: value.projectKey, id: value.id, requestId: value.requestId, type: value.type, text: value.text?.trim(), done: value.done };
}
