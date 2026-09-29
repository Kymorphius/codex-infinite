const ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const MAX_RESTART_MARKS = 200;
export const RESTART_MARK_PROVIDERS = ['local', 'terminal'];

const clean = (value, limit) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);

export function normalizeRestartMark(input) {
  const id = String(input?.id || '').toLowerCase();
  const markedAt = Date.parse(input?.markedAt);
  if (!ID_PATTERN.test(id) || !RESTART_MARK_PROVIDERS.includes(input?.provider) || !Number.isFinite(markedAt)) return null;
  const deviceId = clean(input.deviceId, 100);
  const restartedAt = Date.parse(input.restartedAt);
  const verify = input.status === 'verify';
  return { id, provider: input.provider, ...(deviceId ? { deviceId } : {}), title: clean(input.title, 160) || `会话 ${id.slice(0, 8)}`, markedAt: new Date(markedAt).toISOString(), status: verify ? 'verify' : 'restart', ...(verify && Number.isFinite(restartedAt) ? { restartedAt: new Date(restartedAt).toISOString() } : {}) };
}

export function normalizeRestartMarkState(value) {
  const marks = {};
  const source = value?.marks && typeof value.marks === 'object' && !Array.isArray(value.marks) ? Object.values(value.marks) : [];
  for (const item of source.slice(0, MAX_RESTART_MARKS)) {
    const mark = normalizeRestartMark(item);
    if (mark) marks[mark.id] = mark;
  }
  const appInstance = clean(value?.appInstance, 200);
  return { version: 1, appInstance: appInstance || null, marks };
}

// Marks belong to one run of the app. A known, different instance means the app restarted:
// pending restarts become items to verify; the user decides when they are done.
export function reconcileRestartMarks(state, appInstance, now = new Date().toISOString()) {
  if (!appInstance || state.appInstance === appInstance) return state;
  if (!state.appInstance) return { ...state, appInstance };
  const marks = {};
  for (const mark of Object.values(state.marks)) marks[mark.id] = mark.status === 'verify' ? mark : { ...mark, status: 'verify', restartedAt: now };
  return { version: 1, appInstance, marks };
}

export function restartMarkList(state) {
  return Object.values(state.marks).sort((a, b) => Date.parse(b.markedAt) - Date.parse(a.markedAt) || a.id.localeCompare(b.id));
}

export function parseRestartMarkRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || '')); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(value.id || ''))) return null;
  const id = String(value.id);
  if (value.kind === 'list') return { id, kind: 'list' };
  if (value.kind === 'resolve') return ID_PATTERN.test(String(value.conversationId || '')) && ['passed', 'failed'].includes(value.outcome) ? { id, kind: 'resolve', conversationId: String(value.conversationId).toLowerCase(), outcome: value.outcome } : null;
  if (value.kind !== 'set' || typeof value.marked !== 'boolean' || !ID_PATTERN.test(String(value.conversationId || '')) || !RESTART_MARK_PROVIDERS.includes(value.provider)) return null;
  return { id, kind: 'set', marked: value.marked, conversationId: String(value.conversationId).toLowerCase(), provider: value.provider, deviceId: clean(value.deviceId, 100), title: clean(value.title, 160) };
}
