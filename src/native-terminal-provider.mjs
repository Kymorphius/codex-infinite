import { readNativeSidebarModel } from './native-sidebar-model.mjs';
import { nativeTerminalProjectList, nativeTerminalProjectPlacement, createNativeTerminalSidebar } from './native-terminal-sidebar.mjs';
import { createNativeTerminalActions } from './native-terminal-actions.mjs';

export function installNativeTerminalProvider(dashboardUrl, readModel, makeSidebar, makeActions, prepareConnection = () => false) {
  window.__cccTerminalConversations?.dispose?.();
  const native = window.__cccTerminalNative;
  const origin = new URL(dashboardUrl).origin, channel = crypto.randomUUID(), pending = new Map();
  let ready = Boolean(native), disposed = false, reading = false, records = [], timer = null, selected = '', restoreActive = true, acceptedVersion = 0;
  const frame = native ? null : document.createElement('iframe');
  if (frame) { frame.hidden = true; frame.setAttribute('data-ccc-terminal-bridge', ''); frame.src = origin + '/terminal-bridge.html?channel=' + encodeURIComponent(channel); }
  function request(operation, input = {}) {
    if (native && !disposed) return native.request(operation, input);
    if (!ready || disposed) {
      if (!disposed && prepareConnection()) return Promise.reject(Error('正在准备会话管理，请页面恢复后再次操作'));
      return Promise.reject(Error('会话管理正在连接，请稍后重试'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(Error('会话操作超时，请刷新核对')); }, 30000);
      pending.set(id, { resolve, reject, timeout });
      frame.contentWindow.postMessage({ type: 'codex-terminal-request', channel, id, operation, input }, origin);
    });
  }
  function sync() {
    if (disposed) return;
    window.__codexControlConsoleConversationTabs?.syncTerminal?.(records);
    const active = window.__codexControlConsoleConversationTabs?.active?.();
    sidebar.render(records, active?.kind === 'terminal' ? active.id : '');
    window.__codexControlConsoleProjectSearch?.refresh?.();
  }
  function signature(record) {
    if (!record) return '';
    const project = record.projectRef, runtime = record.runtimeSummary;
    return JSON.stringify([record.id, record.deviceId, record.provider, record.revision, record.title, record.cwd, record.kind, record.pinned, record.archived,
      record.createdAt, record.updatedAt, record.status, record.runtimeSessionId, record.runtimeError, record.occupiedElsewhere, record.lastUserMessageAt,
      project && [project.source, project.key, project.id, project.hostId], runtime && [runtime.id, runtime.status, runtime.exitCode, runtime.cols, runtime.rows, runtime.replayTruncated]]);
  }
  function accept(record) {
    if (disposed || record?.provider !== 'terminal') return;
    const previous = records.find(value => value.id === record.id && value.deviceId === record.deviceId);
    if (signature(previous) === signature(record)) return;
    if (previous && Number(previous.revision) > Number(record.revision)) return;
    acceptedVersion++;
    records = [...records.filter(value => value.id !== record.id), record]; sync();
    window.__codexControlConsoleTerminalChanged?.(record);
  }
  async function refresh() {
    if (!ready || reading || disposed) return;
    reading = true; const version = acceptedVersion;
    try {
      const result = await request('list'); if (disposed || version !== acceptedVersion) return;
      const next = result.conversations || [], changed = next.filter(record => signature(record) !== signature(records.find(value => value.id === record.id && value.deviceId === record.deviceId)));
      records = next; sync();
      for (const record of changed) window.__codexControlConsoleTerminalChanged?.(record);
      if (restoreActive) {
        restoreActive = false;
        const active = window.__codexControlConsoleConversationTabs?.active?.();
        const record = active?.kind === 'terminal' && records.find(value => value.id === active.id && value.deviceId === active.deviceId && !value.archived);
        if (record && !document.querySelector('[data-codex-control-console-workspace]')) window.__codexControlConsoleOpenTerminalConversation?.(record);
      }
    }
    catch { /* Keep the last provider-owned snapshot while disconnected. */ }
    finally { reading = false; }
  }
  const actions = makeActions({ documentRef: document, windowRef: window, request, accept, readModel });
  const sidebar = makeSidebar({ documentRef: document, readModel, open: record => window.__codexControlConsoleOpenTerminalConversation?.(record), menu: actions.menu });
  function receive(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin || event.data?.channel !== channel || disposed) return;
    if (event.data.type === 'codex-terminal-ready') { ready = true; void refresh(); return; }
    if (event.data.type !== 'codex-terminal-response') return;
    const entry = pending.get(event.data.id); if (!entry) return;
    pending.delete(event.data.id); clearTimeout(entry.timeout);
    if (event.data.error) entry.reject(Error(event.data.error)); else entry.resolve(event.data.result);
  }
  function schedule(records) {
    if (timer || disposed || records?.every(record => record.target?.closest?.('[data-ccc-terminal-sidebar]'))) return;
    timer = setTimeout(() => { timer = null; sync(); }, 200);
  }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-app-action-sidebar-project-collapsed', 'data-app-action-sidebar-section-collapsed', 'aria-selected'] });
  window.addEventListener('message', receive); if (frame) document.body.append(frame);
  const interval = setInterval(refresh, 5000);
  window.__cccTerminalConversations = {
    refresh, accept, create: actions.create, request, records: () => records,
    async open(reference) {
      try {
        const result = await request('open', { id: reference.conversationId || reference.id });
        if (reference.deviceId && reference.deviceId !== result.conversation?.deviceId) throw Error('请在会话所属设备打开');
        accept(result.conversation); return result.conversation;
      }
      catch (error) { actions.notice(error.message); return null; }
    },
    select(id) { selected = id || ''; sidebar.render(records, selected); },
    dispose() { disposed = true; ready = false; clearInterval(interval); clearTimeout(timer); observer.disconnect(); window.removeEventListener('message', receive); frame?.remove(); sidebar.destroy(); actions.destroy(); for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(Error('会话管理已重新连接')); } pending.clear(); }
  };
  if (native) void refresh();
  return window.__cccTerminalConversations;
}

export function buildNativeTerminalProviderSource() {
  return [readNativeSidebarModel, nativeTerminalProjectList, nativeTerminalProjectPlacement, createNativeTerminalSidebar, createNativeTerminalActions, installNativeTerminalProvider].map(fn => fn.toString()).join('\n');
}
