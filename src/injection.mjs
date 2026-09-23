import { buildVersionedNativeTabsSource } from "./native-tabs-injection-version.mjs";
import { NATIVE_ENTRY_ICONS } from "./native-entry-icons.mjs";
import { buildEmbeddedFrameRecoveryInjectionSource } from "./embedded-frame-recovery.mjs";
import { installNativeProjectManagementEntry } from "./native-project-management-entry.mjs";
import { installNativeConversationBoardEntry } from "./native-conversation-board-entry.mjs";
import { findNativeEntryAnchor, nativeEntryMutationNeedsInstall } from "./native-entry-probe.mjs";
import { openNativeChecklistTask } from './native-checklist-board-jump.mjs';

export const CONTROL_ENTRY_ATTRIBUTE = "data-codex-control-console-entry";
export const KANBAN_ENTRY_ATTRIBUTE = "data-codex-control-console-kanban-entry";
export const SESSION_ENTRY_ATTRIBUTE = "data-codex-control-console-session-entry";
export const PRIORITY_ENTRY_ATTRIBUTE = "data-codex-control-console-priority-entry";
export const CONTROL_WORKSPACE_ATTRIBUTE = "data-codex-control-console-workspace";

export function injectionDecision({ hasEntry, hasAnchor }) {
  if (hasEntry) return "already-installed";
  if (hasAnchor) return "install-native-entry";
  return "wait-for-native-entry";
}

export function buildInjectionScript(dashboardUrl) {
  const dashboardLiteral = JSON.stringify(dashboardUrl);
  const entryAttribute = JSON.stringify(CONTROL_ENTRY_ATTRIBUTE);
  const workspaceAttribute = JSON.stringify(CONTROL_WORKSPACE_ATTRIBUTE);
  const { nativeConversationTabsSource, digest } = buildVersionedNativeTabsSource();
  const embeddedFrameRecoverySource = buildEmbeddedFrameRecoveryInjectionSource();

  return `(() => {
  const DASHBOARD_URL = ${dashboardLiteral};
  const ENTRY_ATTRIBUTE = ${entryAttribute};
  const KANBAN_ENTRY_ATTRIBUTE = ${JSON.stringify(KANBAN_ENTRY_ATTRIBUTE)};
  const SESSION_ENTRY_ATTRIBUTE = ${JSON.stringify(SESSION_ENTRY_ATTRIBUTE)};
  const PRIORITY_ENTRY_ATTRIBUTE = ${JSON.stringify(PRIORITY_ENTRY_ATTRIBUTE)};
  const WORKSPACE_ATTRIBUTE = ${workspaceAttribute};
  const ENTRY_SELECTOR = '[' + ENTRY_ATTRIBUTE + ']';
  const KANBAN_ENTRY_SELECTOR = '[' + KANBAN_ENTRY_ATTRIBUTE + ']';
  const SESSION_ENTRY_SELECTOR = '[' + SESSION_ENTRY_ATTRIBUTE + ']';
  const PRIORITY_ENTRY_SELECTOR = '[' + PRIORITY_ENTRY_ATTRIBUTE + ']';
  const WORKSPACE_SELECTOR = '[' + WORKSPACE_ATTRIBUTE + ']';
  const INJECTION_VERSION = ${JSON.stringify(`2026-09-23.board-task-jump1.tabs-${digest}`)};
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
${findNativeEntryAnchor.toString()}
${nativeEntryMutationNeedsInstall.toString()}
${openNativeChecklistTask.toString()}
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

  const nativeAnchor = () => findNativeEntryAnchor(document, normalize);

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
    url.searchParams.set('module', ['console', 'sessions', 'priority', 'projects', 'conversations'].includes(module) ? module : 'board');
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
    if (requestEmbeddedFramePreparation(module)) return;
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
      if (!activeFrame || activeFrame.getAttribute('src') !== targetUrl) {
        if (workspaceHost) restoreWorkspace();
        else existing.remove();
        openWorkspace(module, loadingLabel, activateConsole);
        return;
      }
      activeFrame?.focus();
      activeFrame?.contentWindow?.postMessage({ type: 'codex-control-console-show-module', module }, DASHBOARD_ORIGIN);
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
    frame.title = module === 'conversations' ? '会话看板' : module === 'projects' ? '项目管理' : module === 'console' ? 'Codex 控制台' : module === 'sessions' ? 'Codex 会话中心' : module === 'priority' ? 'Codex 项目优先级' : 'Codex 看板';
    frame.setAttribute('data-codex-control-console-frame', '');
    frame.setAttribute('allow', FRAME_ALLOW);
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:' + workspaceBackground + ';';
    const openingFrame = frame;
    const loading = document.createElement('div');
    loading.setAttribute(FRAME_LOADING_ATTRIBUTE, '');
    loading.textContent = loadingLabel || (module === 'conversations' ? '正在打开会话看板…' : module === 'projects' ? '正在打开项目管理…' : module === 'console' ? '正在打开控制台…' : module === 'sessions' ? '正在打开会话中心…' : module === 'priority' ? '正在打开项目优先级…' : '正在打开看板…');
    loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:' + loadingColor + ';font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;';
    monitorEmbeddedFrame(openingFrame, () => frame, loading, module);
    overlay.append(loading, frame);
    for (const child of Array.from(workspaceHost.children)) {
      if (child !== overlay && !child.hasAttribute('data-codex-control-console-original-display')) {
        child.setAttribute('data-codex-control-console-original-display', child.style.display || '');
        child.style.display = 'none';
      }
    }
    workspaceHost.append(overlay);
    window.__codexControlConsoleClose = restoreWorkspace;
  }

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

  async function openTask(task) {
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
    const anchor = nativeAnchor();
    const fallback = document.querySelector('[data-codex-control-console-fallback]');
    const definitions = [
      { attribute: ENTRY_ATTRIBUTE, text: ENTRY_TEXT, module: 'console' },
      { attribute: KANBAN_ENTRY_ATTRIBUTE, text: KANBAN_ENTRY_TEXT, module: 'board' },
      { attribute: SESSION_ENTRY_ATTRIBUTE, text: SESSION_ENTRY_TEXT, module: 'sessions' },
      { attribute: PRIORITY_ENTRY_ATTRIBUTE, text: PRIORITY_ENTRY_TEXT, module: 'priority' }
    ];
    const missing = definitions.filter((definition) => !document.querySelector('[' + definition.attribute + ']'));
    if (!anchor) {
      fallback?.remove();
      return;
    }
    fallback?.remove();
    const insertionPoint = anchor.nextSibling;
    for (const definition of missing) {
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = anchor.className;
      entry.setAttribute(definition.attribute, '');
      entry.setAttribute('aria-label', definition.text);
      entry.innerHTML = entryIcons[definition.module] + '<span class="truncate">' + definition.text + '</span>';
      entry.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openWorkspace(definition.module); });
      anchor.parentElement?.insertBefore(entry, insertionPoint);
    }
    scheduleEmbeddedFrameRecovery(
      () => !document.querySelector(WORKSPACE_SELECTOR) && Boolean(nativeAnchor()),
      (recovery) => openWorkspace(recovery.module, '正在恢复控制台…')
    );
  }

  window.addEventListener('message', async (event) => {
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === FRAME_READY_TYPE) {
      acceptEmbeddedFrameReady(event, frame);
    } else if (event.data.type === 'codex-control-console-open-task') {
      const result = await openTask(event.data.task || {}).catch((error) => ({ ok: false, method: 'native-route-error', message: error.message }));
      postToDashboard({ type: 'codex-control-console-open-task-result', result });
      if (result.ok) restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-close') {
      restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-open-checklist-task') openNativeChecklistTask(event.data.taskId, restoreWorkspace);
  });

  function scheduleInstall(records = []) {
    for (const subscriber of window.__codexControlConsoleMutationSubscribers || []) { try { subscriber(records); } catch {} }
    if (!nativeEntryMutationNeedsInstall(records)) return;
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(installEntry, 30);
  }

  function handleNativeThreadSelection(event) {
    const conversation = event.target?.closest?.('[data-app-action-sidebar-thread-id],[data-sidebar-chatgpt-conversation-key],[data-codex-control-console-ordinary-chat-row]'); if (!conversation || !document.querySelector(WORKSPACE_SELECTOR)) return; setTimeout(restoreWorkspace, 0);
  }

  function boot() {
    if (window.__codexControlConsoleObserver) return;
    if (!document.documentElement || !document.body) {
      setTimeout(boot, 25);
      return;
    }
    installEntry();
    window.__codexControlConsoleConversationTabs = installNativeConversationTabs({
      workspaceCandidate,
      openConsole: (module) => openWorkspace(module || 'board'),
      openLocal: (tab) => {
        restoreWorkspace(); const openNativeThread = window.__codexControlConsoleOpenNativeThread;
        if (typeof openNativeThread === 'function') {
          void openNativeThread(tab.id).catch(() => window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(tab.id) }, '*'));
          return;
        }
        window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(tab.id) }, '*');
      },
      openChatgpt: (tab) => { restoreWorkspace(); window.postMessage({ type: 'navigate-to-route', path: '/c/' + encodeURIComponent(tab.id) }, '*'); },
      openWindow: (_tab, request) => {
        const send = window.electronBridge?.sendMessageFromView;
        if (typeof send !== 'function' || request?.type !== 'open-in-new-window' || !/^\\/(?:local|c)\\/[0-9a-f-]{36}$/i.test(request?.path || '')) return false;
        return send(request).then(() => true);
      },
      openRemote: (tab) => openRemoteConversation(tab)
    });
    window.__codexControlConsoleNativeThreadListener = handleNativeThreadSelection;
    document.addEventListener('click', handleNativeThreadSelection, true);
    window.__codexControlConsoleObserver = new MutationObserver(scheduleInstall);
    window.__codexControlConsoleObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();`;
}
