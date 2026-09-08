import { buildNativeConversationTabsInjectionSource } from "./native-conversation-tabs.mjs";
import { NATIVE_ENTRY_ICONS } from "./native-entry-icons.mjs";

export const CONTROL_ENTRY_ATTRIBUTE = "data-codex-control-console-entry";
export const KANBAN_ENTRY_ATTRIBUTE = "data-codex-control-console-kanban-entry";
export const SESSION_ENTRY_ATTRIBUTE = "data-codex-control-console-session-entry";
export const PRIORITY_ENTRY_ATTRIBUTE = "data-codex-control-console-priority-entry";
export const CONTROL_WORKSPACE_ATTRIBUTE = "data-codex-control-console-workspace";

export function injectionDecision({ hasEntry, hasAnchor }) {
  if (hasEntry) return "already-installed";
  if (hasAnchor) return "install-native-entry";
  return "install-fallback-entry";
}

export function buildInjectionScript(dashboardUrl) {
  const dashboardLiteral = JSON.stringify(dashboardUrl);
  const entryAttribute = JSON.stringify(CONTROL_ENTRY_ATTRIBUTE);
  const workspaceAttribute = JSON.stringify(CONTROL_WORKSPACE_ATTRIBUTE);
  const nativeConversationTabsSource = buildNativeConversationTabsInjectionSource();

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
  const INJECTION_VERSION = '2026-09-08.1';
  const ENTRY_TEXT = '控制台';
  const KANBAN_ENTRY_TEXT = '看板';
  const SESSION_ENTRY_TEXT = '会话中心';
  const PRIORITY_ENTRY_TEXT = '项目优先级';
  const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
  const FRAME_ALLOW = 'clipboard-read; clipboard-write';
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

${nativeConversationTabsSource}

  if (window.__codexControlConsoleInjectionVersion === INJECTION_VERSION && document.querySelector(ENTRY_SELECTOR) && document.querySelector(KANBAN_ENTRY_SELECTOR) && document.querySelector(SESSION_ENTRY_SELECTOR) && document.querySelector(PRIORITY_ENTRY_SELECTOR) && document.querySelector('[data-codex-control-console-native-tabs]') && window.__codexControlConsoleObserver) return;
  if (window.__codexControlConsoleInjected) {
    window.__codexControlConsoleObserver?.disconnect?.();
    if (window.__codexControlConsoleNativeThreadListener) document.removeEventListener('click', window.__codexControlConsoleNativeThreadListener, true);
    window.__codexControlConsoleClose?.();
    document.querySelectorAll(ENTRY_SELECTOR + ',' + KANBAN_ENTRY_SELECTOR + ',' + SESSION_ENTRY_SELECTOR + ',' + PRIORITY_ENTRY_SELECTOR + ',[data-codex-control-console-titlebar-session-entry],[data-codex-control-console-fallback]').forEach((element) => element.remove());
    window.__codexControlConsoleObserver = null;
  }
  window.__codexControlConsoleInjected = true;
  window.__codexControlConsoleInjectionVersion = INJECTION_VERSION;

  let observerTimer = null;
  let workspaceHost = null;
  let frame = null;
  const entryIcons = ${JSON.stringify(NATIVE_ENTRY_ICONS)};

  function nativeAnchor() {
    return Array.from(document.querySelectorAll('button.sidebar-item, button')).find((element) => {
      const text = normalize(element.innerText || element.textContent);
      return ['插件', 'Apps', '站点', 'Sites', '已安排', 'Scheduled'].includes(text);
    }) || null;
  }

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
    url.searchParams.set('module', ['console', 'sessions', 'priority'].includes(module) ? module : 'board');
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
    frame.title = module === 'console' ? 'Codex 控制台' : module === 'sessions' ? 'Codex 会话中心' : module === 'priority' ? 'Codex 项目优先级' : 'Codex 看板';
    frame.setAttribute('data-codex-control-console-frame', '');
    frame.setAttribute('allow', FRAME_ALLOW);
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:' + workspaceBackground + ';';
    const loading = document.createElement('div');
    loading.textContent = loadingLabel || (module === 'console' ? '正在打开控制台…' : module === 'sessions' ? '正在打开会话中心…' : module === 'priority' ? '正在打开项目优先级…' : '正在打开看板…');
    loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:' + loadingColor + ';font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;';
    frame.addEventListener('load', () => {
      loading.remove();
      frame.setAttribute('data-codex-control-console-frame-ready', '');
    }, { once: true });
    setTimeout(() => {
      if (loading.isConnected) loading.textContent = '控制台页面仍在加载，请确认 127.0.0.1:47831 可用。';
    }, 5000);
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
    else activeFrame.addEventListener('load', send, { once: true });
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

  function createFallbackEntry() {
    if (document.querySelector('[data-codex-control-console-fallback]')) return;
    const rail = document.createElement('aside');
    rail.setAttribute('data-codex-control-console-fallback', '');
    rail.style.cssText = 'position:fixed;left:8px;top:58px;z-index:2147483000;display:flex;align-items:center;gap:6px;';
    for (const definition of [
      { attribute: ENTRY_ATTRIBUTE, text: ENTRY_TEXT, module: 'console' },
      { attribute: KANBAN_ENTRY_ATTRIBUTE, text: KANBAN_ENTRY_TEXT, module: 'board' },
      { attribute: SESSION_ENTRY_ATTRIBUTE, text: SESSION_ENTRY_TEXT, module: 'sessions' },
      { attribute: PRIORITY_ENTRY_ATTRIBUTE, text: PRIORITY_ENTRY_TEXT, module: 'priority' }
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute(definition.attribute, '');
      button.setAttribute('aria-label', definition.text);
      button.style.cssText = 'display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid rgba(0,0,0,.12);border-radius:10px;background:#fff;color:#2f2f2f;box-shadow:0 5px 18px rgba(0,0,0,.12);font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;';
      button.innerHTML = entryIcons[definition.module] + '<span>' + definition.text + '</span>';
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openWorkspace(definition.module); });
      rail.append(button);
    }
    document.body.append(rail);
  }

  function installEntry() {
    if (!document.body) return;
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
      if (missing.length && !fallback) createFallbackEntry();
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
  }

  window.addEventListener('message', async (event) => {
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === 'codex-control-console-open-task') {
      const result = await openTask(event.data.task || {}).catch((error) => ({ ok: false, method: 'native-route-error', message: error.message }));
      postToDashboard({ type: 'codex-control-console-open-task-result', result });
      if (result.ok) restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-close') {
      restoreWorkspace();
    }
  });

  function scheduleInstall() {
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
        restoreWorkspace();
        window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(tab.id) }, '*');
      },
      openChatgpt: (tab) => { restoreWorkspace(); window.postMessage({ type: 'navigate-to-route', path: '/c/' + encodeURIComponent(tab.id) }, '*'); },
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
