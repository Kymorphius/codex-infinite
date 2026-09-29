import { parseRestartMarkRequest } from './restart-mark-contract.mjs';

export const NATIVE_RESTART_MARKS_BINDING = '__codexControlConsoleRestartMarksBridge';

export function buildNativeRestartMarksResponseScript(response) {
  return `window.__codexControlConsoleResolveRestartMarks?.(${JSON.stringify(response ?? null)})`;
}

export async function respondToNativeRestartMarksBinding(payload, connection, service) {
  const request = parseRestartMarkRequest(payload);
  if (!request || !service) return null;
  let response;
  try {
    const result = request.kind === 'list' ? await service.snapshot()
      : request.kind === 'resolve' ? await service.resolve({ id: request.conversationId, outcome: request.outcome })
      : await service.set({ id: request.conversationId, provider: request.provider, deviceId: request.deviceId, title: request.title, marked: request.marked });
    response = { id: request.id, ok: true, marks: result.marks };
  } catch (error) {
    response = { id: request.id, ok: false, message: String(error?.message || '重启需求保存失败').slice(0, 200) };
  }
  await connection.evaluate(buildNativeRestartMarksResponseScript(response));
  return response;
}

/** Extra-binding descriptor understood by CodexInjector. */
export function createNativeRestartMarksBinding(service) {
  return { name: NATIVE_RESTART_MARKS_BINDING, handle: (payload, connection) => respondToNativeRestartMarksBinding(payload, connection, service) };
}

// Page-side mirror of the backend marks, shared by the recent menus and the sidebar panel.
export function installNativeRestartMarksStore(bindingName) {
  const VERSION = '2026-09-29.restart-marks';
  if (window.__codexControlConsoleRestartMarks?.version === VERSION) return window.__codexControlConsoleRestartMarks;
  const listeners = new Set(), pending = new Map();
  let marks = [], sequence = 0;
  const apply = (list) => {
    const next = Array.isArray(list) ? list : [];
    if (JSON.stringify(next) === JSON.stringify(marks)) return;
    marks = next;
    listeners.forEach((listener) => { try { listener(); } catch {} });
  };
  window.__codexControlConsoleResolveRestartMarks = (response) => {
    const waiter = pending.get(String(response?.id || ''));
    if (!waiter) return false;
    pending.delete(String(response.id)); clearTimeout(waiter.timeout);
    if (response.ok) { apply(response.marks); waiter.resolve(response); } else waiter.reject(new Error(response.message || '重启需求保存失败'));
    return true;
  };
  const request = (kind, body = {}) => new Promise((resolve, reject) => {
    const bridge = window[bindingName];
    if (typeof bridge !== 'function') return reject(new Error('重启需求桥不可用'));
    const id = 'restart-marks-' + Date.now() + '-' + (++sequence);
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('重启需求请求超时')); }, 5000);
    pending.set(id, { resolve, reject, timeout });
    try { bridge(JSON.stringify({ id, kind, ...body })); } catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
  const store = {
    version: VERSION,
    list: () => marks.slice(),
    get: (id) => marks.find((mark) => mark.id === id) || null,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    refresh: () => request('list').catch(() => null),
    set: (record, marked) => request('set', { conversationId: record.id, provider: record.provider, deviceId: record.deviceId || '', title: record.title || '', marked }),
    resolve: (id, outcome) => request('resolve', { conversationId: id, outcome }),
    // none -> restart -> none; a converted mark can only be passed here, failing it is explicit.
    toggle(record) { const mark = store.get(record.id); return mark?.status === 'verify' ? store.resolve(record.id, 'passed') : store.set(record, !mark); }
  };
  window.__codexControlConsoleRestartMarks = store;
  store.refresh();
  return store;
}

export function buildNativeRestartMarksStoreSource() {
  return `(${installNativeRestartMarksStore.toString()})(${JSON.stringify(NATIVE_RESTART_MARKS_BINDING)});`;
}
