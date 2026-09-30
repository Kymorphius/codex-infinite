import { createHash } from 'node:crypto';
import { buildNativeProviderNavigationSource } from './native-terminal-navigation.mjs';
import { buildVersionedNativeTabsSource } from "./native-tabs-injection-version.mjs";
import { NATIVE_ENTRY_ICONS } from "./native-entry-icons.mjs";
import { buildEmbeddedFrameRecoveryInjectionSource } from "./embedded-frame-recovery.mjs";
import { installNativeProjectManagementEntry } from "./native-project-management-entry.mjs";
import { installNativeRestartNeedsEntry } from "./native-restart-needs-panel.mjs";
import { installNativeConversationBoardEntry } from "./native-conversation-board-entry.mjs";
import { findNativeEntryAnchor, nativeEntryMutationNeedsInstall, nativeLayoutTransition } from "./native-entry-probe.mjs";
import { openNativeChecklistTask } from './native-checklist-board-jump.mjs';
import { installNativeSidebarModuleEntries } from './native-sidebar-module-entries.mjs';
import { positionNativeSidebarDot } from './native-sidebar-dot-position.mjs';

export const CONTROL_ENTRY_ATTRIBUTE = "data-codex-control-console-entry";
export const KANBAN_ENTRY_ATTRIBUTE = "data-codex-control-console-kanban-entry";
export const SESSION_ENTRY_ATTRIBUTE = "data-codex-control-console-session-entry";
export const PRIORITY_ENTRY_ATTRIBUTE = "data-codex-control-console-priority-entry";
export const CONTROL_WORKSPACE_ATTRIBUTE = "data-codex-control-console-workspace";

export { injectionDecision } from './native-entry-probe.mjs';

export function buildInjectionScript(dashboardUrl, { standaloneDashboardBinding = "" } = {}) {
  const dashboardLiteral = JSON.stringify(dashboardUrl);
  const entryAttribute = JSON.stringify(CONTROL_ENTRY_ATTRIBUTE);
  const workspaceAttribute = JSON.stringify(CONTROL_WORKSPACE_ATTRIBUTE);
  const { nativeConversationTabsSource, digest } = buildVersionedNativeTabsSource();
  const embeddedFrameRecoverySource = buildEmbeddedFrameRecoveryInjectionSource();
  const providerSource = buildNativeProviderNavigationSource();
  const providerDigest = createHash('sha256').update(providerSource).digest('hex').slice(0, 12);
  const probeDigest = createHash('sha256').update(findNativeEntryAnchor.toString() + nativeLayoutTransition.toString()).digest('hex').slice(0, 8);
  const sidebarDigest = createHash('sha256').update(installNativeSidebarModuleEntries.toString() + positionNativeSidebarDot.toString()).digest('hex').slice(0, 8);

  return `(() => {
  const DASHBOARD_URL = ${dashboardLiteral};
  const ENTRY_ATTRIBUTE = ${entryAttribute};
  const KANBAN_ENTRY_ATTRIBUTE = ${JSON.stringify(KANBAN_ENTRY_ATTRIBUTE)};
  const SESSION_ENTRY_ATTRIBUTE = ${JSON.stringify(SESSION_ENTRY_ATTRIBUTE)};
  const PRIORITY_ENTRY_ATTRIBUTE = ${JSON.stringify(PRIORITY_ENTRY_ATTRIBUTE)};
  const WORKSPACE_ATTRIBUTE = ${workspaceAttribute};
  const STANDALONE_DASHBOARD_BINDING = ${JSON.stringify(standaloneDashboardBinding)};
  const ENTRY_SELECTOR = '[' + ENTRY_ATTRIBUTE + ']';
  const KANBAN_ENTRY_SELECTOR = '[' + KANBAN_ENTRY_ATTRIBUTE + ']';
  const SESSION_ENTRY_SELECTOR = '[' + SESSION_ENTRY_ATTRIBUTE + ']';
  const PRIORITY_ENTRY_SELECTOR = '[' + PRIORITY_ENTRY_ATTRIBUTE + ']';
  const WORKSPACE_SELECTOR = '[' + WORKSPACE_ATTRIBUTE + ']';
  const INJECTION_VERSION = ${JSON.stringify(`2026-09-27.chatgpt26.terminal-inline.tabs-${digest}.provider-${providerDigest}.probe-${probeDigest}.sidebar-${sidebarDigest}.standalone-${Boolean(standaloneDashboardBinding)}`)};
  const ENTRY_POLICY_VERSION = '2026-09-09.native-only';
  const ENTRY_TEXT = '控制台';
  const KANBAN_ENTRY_TEXT = '看板';
  const SESSION_ENTRY_TEXT = '会话中心';
  const PRIORITY_ENTRY_TEXT = '项目优先级';
  const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
  const FRAME_ALLOW = 'clipboard-read; clipboard-write';
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
${nativeConversationTabsSource}
${embeddedFrameRecoverySource}
${findNativeEntryAnchor.toString()}${nativeLayoutTransition.toString()}
${nativeEntryMutationNeedsInstall.toString()}
${openNativeChecklistTask.toString()}
${installNativeSidebarModuleEntries.toString()}
${positionNativeSidebarDot.toString()}
  if (window.__codexControlConsoleEntryPolicyVersion === ENTRY_POLICY_VERSION && window.__codexControlConsoleInjectionVersion === INJECTION_VERSION && window.__codexControlConsoleObserver) return;
  if (window.__codexControlConsoleInjected) {
    window.__codexControlConsoleObserver?.disconnect?.();
    if (window.__codexControlConsoleNativeThreadListener) document.removeEventListener('click', window.__codexControlConsoleNativeThreadListener, true);
    window.__codexControlConsoleClose?.();
    document.querySelectorAll(ENTRY_SELECTOR + ',' + KANBAN_ENTRY_SELECTOR + ',' + SESSION_ENTRY_SELECTOR + ',' + PRIORITY_ENTRY_SELECTOR + ',[data-codex-control-console-projects-entry],[data-codex-control-console-conversations-entry],[data-codex-control-console-titlebar-session-entry],[data-codex-control-console-fallback]').forEach((element) => element.remove());
    window.__codexControlConsoleObserver = null;
  }
  window.__codexControlConsoleInjected = true;
  window.__codexControlConsoleInjectionVersion = INJECTION_VERSION;
  window.__codexControlConsoleEntryPolicyVersion = ENTRY_POLICY_VERSION;

  let observerTimer = null;
  let workspaceHost = null;
  let frame = null;
  const entryIcons = ${JSON.stringify(NATIVE_ENTRY_ICONS)};

  let wasNormalLayout = false; const anchorCache = {};
  const nativeAnchor = () => findNativeEntryAnchor(document, normalize, anchorCache);

  function workspaceCandidate() {
    const isVisibleCandidate = (element) => {
      if (!element?.isConnected) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 260 && rect.height > 180 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const semantic = document.querySelector('[role="main"]');
    if (isVisibleCandidate(semantic)) return semantic;
    const candidates = Array.from(document.querySelectorAll('[role="main"], main')).filter(isVisibleCandidate);
    candidates.sort((left, right) => right.getBoundingClientRect().width - left.getBoundingClientRect().width);
    return candidates[0] || document.querySelector('#root') || document.body;
  }

  function restoreWorkspace() {
    cancelEmbeddedFrameRecovery();
    window.__cccNativeTerminalView?.dispose();
    if (!workspaceHost) {
      document.querySelector(WORKSPACE_SELECTOR)?.remove();
      frame = null;
      return;
    }
    for (const child of Array.from(workspaceHost.children)) {
      if (child.matches(WORKSPACE_SELECTOR)) continue;
      if (child.hasAttribute('data-codex-control-console-original-display')) {
        child.style.display = child.getAttribute('data-codex-control-console-original-display');
        child.removeAttribute('data-codex-control-console-original-display');
      }
    }
    const overlay = workspaceHost.querySelector(WORKSPACE_SELECTOR);
    overlay?.remove();
    workspaceHost.style.overflow = workspaceHost.getAttribute('data-codex-control-console-original-overflow') || '';
    workspaceHost.removeAttribute('data-codex-control-console-original-overflow');
    workspaceHost = null;
    frame = null;
  }

  function dashboardUrlFor(module) {
    const url = new URL(DASHBOARD_URL);
    if (module === 'projects') url.pathname = '/projects.html';
    if (module === 'conversations') url.pathname = '/conversations.html';
    url.searchParams.set('module', ['console', 'sessions', 'priority', 'projects', 'conversations', 'terminal'].includes(module) ? module : 'board');
    if (module === 'terminal') { url.searchParams.set('view', 'conversation'); if (terminalTarget) url.searchParams.set('conversationId', terminalTarget.conversationId); }
    url.searchParams.set('theme', nativeTheme());
    url.searchParams.set('embedded', 'native');
    return url.toString();
  }
  function nativeTheme() {
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    if (scheme === 'dark') return 'dark';
    if (scheme === 'light') return 'light';
    for (const element of [workspaceCandidate(), document.body, document.documentElement]) {
      if (!element) continue;
      const values = getComputedStyle(element).backgroundColor.match(/[\\d.]+/g)?.map(Number) || [];
      if (values.length < 3 || (values.length > 3 && values[3] < 0.2)) continue;
      const luminance = values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      return luminance < 128 ? 'dark' : 'light';
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function openWorkspace(module = 'board', loadingLabel = '', activateConsole = true) {
    if (module !== 'terminal') cancelTerminalNavigation();
    if (module !== 'terminal' && STANDALONE_DASHBOARD_BINDING && typeof window[STANDALONE_DASHBOARD_BINDING] === 'function') {
      window[STANDALONE_DASHBOARD_BINDING](JSON.stringify({ module: ['console', 'sessions', 'priority', 'projects', 'conversations', 'terminal'].includes(module) ? module : 'board' }));
      return;
    }
    if (requestEmbeddedFramePreparation(module, terminalTarget)) return; window.__cccNativeTerminalView?.dispose();
    if (activateConsole) window.__codexControlConsoleConversationTabs?.showConsole?.(module);
    let existing = document.querySelector(WORKSPACE_SELECTOR);
    const candidate = workspaceCandidate();
    if (existing) {
      const existingStyle = getComputedStyle(existing);
      const existingRect = existing.getBoundingClientRect();
      const belongsToCurrentWorkspace = Boolean(candidate && candidate.contains(existing));
      const visiblyMounted = existing.isConnected && existingRect.width > 260 && existingRect.height > 180
        && existingStyle.display !== 'none' && existingStyle.visibility !== 'hidden';
      if (!belongsToCurrentWorkspace || !visiblyMounted) {
        if (workspaceHost?.contains(existing)) restoreWorkspace();
        else existing.remove();
        existing = null;
      }
    }
    if (existing) {
      const activeFrame = frame || existing.querySelector('[data-codex-control-console-frame]');
      activeFrame?.setAttribute('allow', FRAME_ALLOW);
      const targetUrl = dashboardUrlFor(module);
      let currentUrl = activeFrame?.getAttribute('src');
      if (module === 'terminal' && currentUrl) { const current = new URL(currentUrl); if (current.searchParams.get('module') === 'terminal') { current.searchParams.set('conversationId', terminalTarget?.conversationId || ''); currentUrl = current.toString(); } }
      if (!activeFrame || currentUrl !== targetUrl) {
        if (workspaceHost) restoreWorkspace();
        else existing.remove();
        openWorkspace(module, loadingLabel, activateConsole);
        return;
      }
      activeFrame?.focus();
      if (module !== 'terminal') activeFrame?.contentWindow?.postMessage({ type: 'codex-control-console-show-module', module }, DASHBOARD_ORIGIN);
      existing.scrollIntoView({ block: 'nearest' });
      return;
    }
    workspaceHost = candidate;
    if (!workspaceHost) return;
    workspaceHost.setAttribute('data-codex-control-console-original-overflow', workspaceHost.style.overflow || '');
    workspaceHost.style.overflow = 'hidden';
    const overlay = document.createElement('section');
    overlay.setAttribute(WORKSPACE_ATTRIBUTE, '');
    overlay.setAttribute('aria-label', 'Codex 控制台工作区');
    const dark = nativeTheme() === 'dark';
    const workspaceBackground = dark ? '#1f1f20' : '#f7f7f8';
    const loadingColor = dark ? '#96969c' : '#6b6b6b';
    overlay.style.cssText = 'display:flex;position:relative;flex:1;min-width:0;min-height:0;width:100%;height:100%;background:' + workspaceBackground + ';overflow:hidden;';
    frame = document.createElement('iframe');
    frame.src = dashboardUrlFor(module);
    frame.title = module === 'terminal' ? '终端会话' : module === 'conversations' ? '会话看板' : module === 'projects' ? '项目管理' : module === 'console' ? 'Codex 控制台' : module === 'sessions' ? 'Codex 会话中心' : module === 'priority' ? 'Codex 项目优先级' : 'Codex 看板';
    frame.setAttribute('data-codex-control-console-frame', '');
    frame.setAttribute('allow', FRAME_ALLOW);
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:' + workspaceBackground + ';';
    const openingFrame = frame;
    const loading = document.createElement('div');
    loading.setAttribute(FRAME_LOADING_ATTRIBUTE, '');
    loading.textContent = loadingLabel || (module === 'conversations' ? '正在打开会话看板…' : module === 'projects' ? '正在打开项目管理…' : module === 'console' ? '正在打开控制台…' : module === 'sessions' ? '正在打开会话中心…' : module === 'priority' ? '正在打开项目优先级…' : '正在打开看板…');
    loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:' + loadingColor + ';font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;';
    monitorEmbeddedFrame(openingFrame, () => frame, loading, module, terminalTarget);
    overlay.append(loading, frame);
    for (const child of Array.from(workspaceHost.children)) {
      if (child !== overlay && !child.hasAttribute('data-codex-control-console-original-display')) {
        child.setAttribute('data-codex-control-console-original-display', child.style.display || '');
        child.style.display = 'none';
      }
    }
    workspaceHost.append(overlay);
    window.__codexControlConsoleClose = () => { cancelTerminalNavigation(); restoreWorkspace(); };
  }

${providerSource}
  async function openTask(task) {
    if (task?.provider === 'terminal') return { ok: await openTerminalConversation(task), method: 'terminal-provider' };
    const title = normalize(task?.title);
    const taskId = normalize(task?.id);
    const localThreadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId) ? taskId : null;
    if (localThreadId) {
      window.__codexControlConsoleConversationTabs?.openLocal?.({ id: localThreadId, title });
      const activation = typeof window.__codexControlConsoleOpenNativeThread === 'function'
        ? await window.__codexControlConsoleOpenNativeThread(localThreadId)
        : (window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(localThreadId) }, '*'), { applied: false });
      return { ok: true, method: activation.applied ? 'native-route-context' : 'native-route-id', id: localThreadId, title, contextWindow: activation.contextWindow || null };
    }
    const nodes = Array.from(document.querySelectorAll('[role="button"], button, a, [role="link"], [tabindex], div, span')).filter((element) => {
      if (element.matches(ENTRY_SELECTOR + ',' + KANBAN_ENTRY_SELECTOR + ',' + SESSION_ENTRY_SELECTOR + ',' + PRIORITY_ENTRY_SELECTOR)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    });
    const exact = title ? nodes.find((element) => normalize(element.innerText || element.textContent) === title) : null;
    const prefix = title ? nodes.find((element) => normalize(element.innerText || element.textContent).startsWith(title.slice(0, 48))) : null;
    const candidate = exact || prefix;
    if (candidate) {
      candidate.scrollIntoView({ block: 'center', behavior: 'instant' });
      candidate.click();
      return { ok: true, method: 'sidebar-title', id: taskId, title };
    }
    return { ok: false, method: 'unsupported', id: taskId, title, message: '该任务不在当前 Codex 侧边栏中，暂不支持直接打开。' };
  }

  function postToDashboard(message) {
    if (frame?.contentWindow) frame.contentWindow.postMessage(message, DASHBOARD_ORIGIN);
  }

  function installEntry() {
    if (!document.body) return;
    (${installNativeProjectManagementEntry.toString()})(() => openWorkspace('projects'));
    (${installNativeConversationBoardEntry.toString()})(() => openWorkspace('conversations'));
    (${installNativeRestartNeedsEntry.toString()})();
    const layout = nativeLayoutTransition(document, wasNormalLayout); wasNormalLayout = layout.normal; if (layout.leftNormal) { cancelTerminalNavigation(); restoreWorkspace(); } const anchor = layout.normal ? nativeAnchor() : null;
    const fallback = document.querySelector('[data-codex-control-console-fallback]');
    const definitions = [
      { attribute: KANBAN_ENTRY_ATTRIBUTE, text: KANBAN_ENTRY_TEXT, module: 'board' },
      { attribute: ENTRY_ATTRIBUTE, text: ENTRY_TEXT, module: 'console' },
      { attribute: SESSION_ENTRY_ATTRIBUTE, text: SESSION_ENTRY_TEXT, module: 'sessions' },
      { attribute: PRIORITY_ENTRY_ATTRIBUTE, text: PRIORITY_ENTRY_TEXT, module: 'priority' }
    ];
    if (!anchor) {
      fallback?.remove();
      return;
    }
    fallback?.remove();
    const shortcutAnchor = positionNativeSidebarDot(document, anchor) || anchor;
    installNativeSidebarModuleEntries(document, anchor, definitions, entryIcons, module => openWorkspace(module), shortcutAnchor);
    scheduleEmbeddedFrameRecovery(
      () => !document.querySelector(WORKSPACE_SELECTOR) && Boolean(nativeAnchor()),
      (recovery) => { terminalTarget = recovery.reference || null; openWorkspace(recovery.module, '正在恢复会话…', recovery.module !== 'terminal'); }
    );
  }

  window.addEventListener('message', async (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== DASHBOARD_ORIGIN || !event.data) return;
    if (acceptTerminalMessage(event)) return;
    if (event.data.type === FRAME_READY_TYPE) {
      acceptEmbeddedFrameReady(event, frame);
    } else if (event.data.type === 'codex-control-console-open-task') {
      const result = await openTask(event.data.task || {}).catch((error) => ({ ok: false, method: 'native-route-error', message: error.message }));
      postToDashboard({ type: 'codex-control-console-open-task-result', result });
      if (result.ok && result.method !== 'terminal-provider') restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-close') {
      cancelTerminalNavigation(); restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-open-checklist-task') openNativeChecklistTask(event.data.taskId, restoreWorkspace);
  });

  function scheduleInstall(records = []) {
    for (const subscriber of window.__codexControlConsoleMutationSubscribers || []) { try { subscriber(records); } catch {} }
    if (!nativeEntryMutationNeedsInstall(records)) return;
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(installEntry, 30);
  }

  function handleNativeThreadSelection(event) {
    if (!nativeNavigationControl(event.target)) return; cancelTerminalNavigation(); if (document.querySelector(WORKSPACE_SELECTOR)) setTimeout(restoreWorkspace, 0);
    // A new chat mounts no thread to re-activate, so drop the terminal tab or a reload reopens it over the native page.
    const tabs = window.__codexControlConsoleConversationTabs; if (tabs?.active?.()?.kind === 'terminal') tabs.showConsole?.(undefined, true);
  }

  function boot() {
    if (window.__codexControlConsoleObserver) return;
    if (!document.documentElement || !document.body) {
      setTimeout(boot, 25);
      return;
    }
    installEntry();
    // Console-owned sidebar rows close any console workspace before routing. The
    // native terminal view never opens the iframe workspace, so define it at boot.
    window.__codexControlConsoleClose = () => { cancelTerminalNavigation(); restoreWorkspace(); };
    window.__codexControlConsoleConversationTabs = installNativeConversationTabs({
      workspaceCandidate,
      openConsole: (module) => openWorkspace(module || 'board'),
      openLocal: (tab) => {
        cancelTerminalNavigation(); restoreWorkspace(); const openNativeThread = window.__codexControlConsoleOpenNativeThread;
        if (typeof openNativeThread === 'function') {
          void openNativeThread(tab.id).catch(() => window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(tab.id) }, '*'));
          return;
        }
        window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(tab.id) }, '*');
      },
      openChatgpt: (tab) => { cancelTerminalNavigation(); restoreWorkspace(); window.postMessage({ type: 'navigate-to-route', path: '/c/' + encodeURIComponent(tab.id) }, '*'); },
      openWindow: (_tab, request) => {
        const send = window.electronBridge?.sendMessageFromView;
        if (typeof send !== 'function' || request?.type !== 'open-in-new-window' || !/^\\/(?:local|c)\\/[0-9a-f-]{36}$/i.test(request?.path || '')) return false;
        return send(request).then(() => true);
      },
      openRemote: (tab) => openRemoteConversation(tab),
      openTerminal: (tab) => openTerminalConversation(tab)
    });
    if (!STANDALONE_DASHBOARD_BINDING || window.__cccTerminalNative) installNativeTerminalProvider(DASHBOARD_URL, readNativeSidebarModel, createNativeTerminalSidebar, createNativeTerminalActions, () => requestEmbeddedFramePreparation('projects'));
    window.__codexControlConsoleNativeThreadListener = handleNativeThreadSelection;
    document.addEventListener('click', handleNativeThreadSelection, true);
    window.__codexControlConsoleObserver = new MutationObserver(scheduleInstall);
    window.__codexControlConsoleObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();`;
}
