import { buildNativeTerminalProviderSource } from './native-terminal-provider.mjs';

// ChatGPT 26 narrows role=main to the home composer; its mode toggle (聊天/工作) and
// thread headers are siblings. Terminal conversations own the whole focus area.
export function nativeTerminalHost(fallback) {
  const main = fallback(), area = main?.closest?.('[data-app-shell-focus-area="main"]');
  const rect = area?.isConnected ? area.getBoundingClientRect() : null;
  const host = rect && rect.width > 260 && rect.height > 180 ? area : main;
  // While the page is still loading, workspaceCandidate() falls back to #root/body. Mounting there puts the
  // terminal beside the whole app layout and pushes that layout out of the window, so wait for a real main area.
  return host && !/^(BODY|HTML)$/.test(host.tagName || '') && host.id !== 'root' ? host : null;
}

// Native controls that replace the main page. The terminal view hides that page, so a
// click on any of them must close the view first: thread rows and the new-chat buttons
// (global and per-project). Console-owned sidebar controls never match.
export function nativeNavigationControl(target) {
  const row = target?.closest?.('[data-app-action-sidebar-thread-id],[data-sidebar-chatgpt-conversation-key],[data-codex-control-console-ordinary-chat-row]');
  if (row) return row;
  const button = target?.closest?.('button,a,[role="button"]');
  if (!button || button.closest('[data-ccc-terminal-sidebar],[data-codex-control-console-workspace]')) return null;
  const label = (button.getAttribute('aria-label') || button.textContent || '').trim();
  return /^(新聊天|新对话|新建任务|New chat|New task)$|开始新聊天|新建会话|Start new chat|New chat in/i.test(label) ? button : null;
}

export function buildNativeProviderNavigationSource() {
  return `
${buildNativeTerminalProviderSource()}
${nativeTerminalHost}
${nativeNavigationControl}
  let terminalTarget = null, terminalNavigationVersion = 0;
  function cancelTerminalNavigation() { terminalTarget = null; terminalNavigationVersion++; }
  function terminalReference(reference) {
    const id = reference?.conversationId || reference?.id;
    if (reference?.provider !== 'terminal' && reference?.kind !== 'terminal') return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) return null;
    return { provider: 'terminal', conversationId: id, ...(reference.deviceId ? { deviceId: reference.deviceId } : {}) };
  }
  async function openTerminalConversation(reference) {
    const target = terminalReference(reference); if (!target) return false;
    const version = ++terminalNavigationVersion;
    const record = reference?.provider === 'terminal' && reference?.revision && reference?.title ? reference : await window.__cccTerminalConversations?.open(target);
    if (version !== terminalNavigationVersion || !record || record.archived) return false;
    terminalTarget = { ...target, deviceId: record.deviceId };
    window.__codexControlConsoleConversationTabs?.openTerminal?.(terminalConversationTab(record));
    window.__cccTerminalConversations?.select(record.id);
    if (window.__cccOpenNativeTerminal) { restoreWorkspace(); return window.__cccOpenNativeTerminal(record, nativeTerminalHost(workspaceCandidate)); }
    openWorkspace('terminal', '正在打开会话…', false);
    const activeFrame = frame; if (!activeFrame?.contentWindow) return true;
    const send = () => {
      if (version !== terminalNavigationVersion || frame !== activeFrame) return;
      activeFrame.contentWindow.postMessage({ type: 'codex-control-console-open-terminal-conversation', ...terminalTarget, reference: terminalTarget }, DASHBOARD_ORIGIN);
    };
    if (activeFrame.hasAttribute('data-codex-control-console-frame-ready')) send();
    else activeFrame.addEventListener(FRAME_READY_TYPE, send, { once: true });
    return true;
  }
  function acceptTerminalMessage(event) {
    if (event.origin !== DASHBOARD_ORIGIN || event.source !== frame?.contentWindow) return false;
    const data = event.data || {};
    if (data.type === 'codex-control-console-open-terminal-conversation') { void openTerminalConversation(data.reference || data); return true; }
    if (!['codex-control-console-terminal-conversation-opened', 'codex-control-console-terminal-conversation-updated'].includes(data.type)) return false;
    const record = data.conversation;
    if (!terminalReference(record)) return true;
    window.__cccTerminalConversations?.accept(record);
    if (data.type.endsWith('-opened') && !record.archived && (!terminalTarget || terminalTarget.conversationId === record.id)) {
      terminalTarget = terminalReference(record);
      window.__codexControlConsoleConversationTabs?.openTerminal?.(terminalConversationTab(record));
      window.__cccTerminalConversations?.select(record.id);
    }
    return true;
  }
  function terminalRecordChanged(record) {
    window.__cccNativeTerminalView?.update(record);
    if (record?.provider !== 'terminal' || !terminalTarget || terminalTarget.conversationId !== record.id || terminalTarget.deviceId !== record.deviceId) return false;
    const activeFrame = frame, version = terminalNavigationVersion;
    if (!activeFrame?.contentWindow) return false;
    const send = () => {
      if (frame !== activeFrame || version !== terminalNavigationVersion || terminalTarget?.conversationId !== record.id || terminalTarget?.deviceId !== record.deviceId) return;
      activeFrame.contentWindow.postMessage({ type: 'codex-control-console-terminal-record-changed', conversation: record }, DASHBOARD_ORIGIN);
    };
    if (activeFrame.hasAttribute('data-codex-control-console-frame-ready')) send();
    else activeFrame.addEventListener(FRAME_READY_TYPE, send, { once: true });
    return true;
  }
  window.__codexControlConsoleOpenTerminalConversation = openTerminalConversation;
  window.__codexControlConsoleTerminalChanged = terminalRecordChanged;
  function openSessionsAction(message) {
    const openingRemote = message?.type === 'codex-control-console-open-remote-conversation';
    const loadingLabel = openingRemote ? '正在打开会话…' : '';
    openWorkspace('sessions', loadingLabel, !openingRemote);
    const activeFrame = frame || document.querySelector('[data-codex-control-console-frame]');
    if (!activeFrame?.contentWindow) return false;
    const send = () => activeFrame.contentWindow?.postMessage(message, DASHBOARD_ORIGIN);
    if (activeFrame.hasAttribute('data-codex-control-console-frame-ready')) send();
    else activeFrame.addEventListener(FRAME_READY_TYPE, send, { once: true });
    return true;
  }
  function openRemoteConversation(reference) {
    const id = normalize(reference?.id).slice(0, 160), deviceId = normalize(reference?.deviceId).slice(0, 120);
    const title = normalize(reference?.title).slice(0, 160), cwd = normalize(reference?.cwd).slice(0, 1024), deviceName = normalize(reference?.deviceName).slice(0, 80);
    const normalized = { id, deviceId, title, cwd, deviceName };
    const opened = Boolean(id && deviceId) && openSessionsAction({ type: 'codex-control-console-open-remote-conversation', reference: normalized });
    if (opened) window.__codexControlConsoleConversationTabs?.openRemote?.(normalized);
    return opened;
  }
  function copyRemoteProject(reference) {
    const deviceId = normalize(reference?.deviceId).slice(0, 120), projectName = normalize(reference?.projectName).slice(0, 100);
    const sourceDirectory = String(reference?.sourceDirectory || '').trim().slice(0, 1024);
    return Boolean(deviceId && sourceDirectory && !/[\\u0000\\r\\n]/.test(sourceDirectory)) && openSessionsAction({ type: 'codex-control-console-copy-remote-project', reference: { deviceId, sourceDirectory, projectName } });
  }
  window.__codexControlConsoleOpenRemoteConversation = openRemoteConversation;
  window.__codexControlConsoleCopyRemoteProject = copyRemoteProject;

  `;
}
