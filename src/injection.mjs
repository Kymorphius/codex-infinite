export const CONTROL_ENTRY_ATTRIBUTE = "data-codex-control-console-entry";
export const KANBAN_ENTRY_ATTRIBUTE = "data-codex-control-console-kanban-entry";
export const SESSION_ENTRY_ATTRIBUTE = "data-codex-control-console-session-entry";
export const TITLEBAR_SESSION_ENTRY_ATTRIBUTE = "data-codex-control-console-titlebar-session-entry";
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

  return `(() => {
  const DASHBOARD_URL = ${dashboardLiteral};
  const ENTRY_ATTRIBUTE = ${entryAttribute};
  const KANBAN_ENTRY_ATTRIBUTE = ${JSON.stringify(KANBAN_ENTRY_ATTRIBUTE)};
  const SESSION_ENTRY_ATTRIBUTE = ${JSON.stringify(SESSION_ENTRY_ATTRIBUTE)};
  const TITLEBAR_SESSION_ENTRY_ATTRIBUTE = ${JSON.stringify(TITLEBAR_SESSION_ENTRY_ATTRIBUTE)};
  const PRIORITY_ENTRY_ATTRIBUTE = ${JSON.stringify(PRIORITY_ENTRY_ATTRIBUTE)};
  const WORKSPACE_ATTRIBUTE = ${workspaceAttribute};
  const ENTRY_SELECTOR = '[' + ENTRY_ATTRIBUTE + ']';
  const KANBAN_ENTRY_SELECTOR = '[' + KANBAN_ENTRY_ATTRIBUTE + ']';
  const SESSION_ENTRY_SELECTOR = '[' + SESSION_ENTRY_ATTRIBUTE + ']';
  const TITLEBAR_SESSION_ENTRY_SELECTOR = '[' + TITLEBAR_SESSION_ENTRY_ATTRIBUTE + ']';
  const PRIORITY_ENTRY_SELECTOR = '[' + PRIORITY_ENTRY_ATTRIBUTE + ']';
  const WORKSPACE_SELECTOR = '[' + WORKSPACE_ATTRIBUTE + ']';
  const INJECTION_VERSION = '2026-08-30.6';
  const ENTRY_TEXT = '控制台';
  const KANBAN_ENTRY_TEXT = '看板';
  const SESSION_ENTRY_TEXT = '会话中心';
  const PRIORITY_ENTRY_TEXT = '项目优先级';
  const DASHBOARD_ORIGIN = new URL(DASHBOARD_URL).origin;
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();

  if (window.__codexControlConsoleInjectionVersion === INJECTION_VERSION && document.querySelector(ENTRY_SELECTOR) && document.querySelector(KANBAN_ENTRY_SELECTOR) && document.querySelector(SESSION_ENTRY_SELECTOR) && document.querySelector(TITLEBAR_SESSION_ENTRY_SELECTOR) && document.querySelector(PRIORITY_ENTRY_SELECTOR) && window.__codexControlConsoleObserver) return;
  if (window.__codexControlConsoleInjected) {
    window.__codexControlConsoleObserver?.disconnect?.();
    window.__codexControlConsoleClose?.();
    document.querySelectorAll(ENTRY_SELECTOR + ',' + KANBAN_ENTRY_SELECTOR + ',' + SESSION_ENTRY_SELECTOR + ',' + TITLEBAR_SESSION_ENTRY_SELECTOR + ',' + PRIORITY_ENTRY_SELECTOR + ',[data-codex-control-console-fallback]').forEach((element) => element.remove());
    window.__codexControlConsoleObserver = null;
  }
  window.__codexControlConsoleInjected = true;
  window.__codexControlConsoleInjectionVersion = INJECTION_VERSION;

  let observerTimer = null;
  let workspaceHost = null;
  let frame = null;
  const iconMarkup = '<span aria-hidden="true" style="display:inline-flex;width:1.1rem;height:1.1rem;align-items:center;justify-content:center;font-size:15px;line-height:1">⌘</span>';

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
    return url.toString();
  }

  function openWorkspace(module = 'board') {
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
      const targetUrl = dashboardUrlFor(module);
      if (!activeFrame || activeFrame.getAttribute('src') !== targetUrl) {
        if (workspaceHost) restoreWorkspace();
        else existing.remove();
        openWorkspace(module);
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
    overlay.style.cssText = 'display:flex;position:relative;flex:1;min-width:0;min-height:0;width:100%;height:100%;background:#f7f7f8;overflow:hidden;';
    frame = document.createElement('iframe');
    frame.src = dashboardUrlFor(module);
    frame.title = module === 'console' ? 'Codex 控制台' : module === 'sessions' ? 'Codex 会话中心' : module === 'priority' ? 'Codex 项目优先级' : 'Codex 看板';
    frame.setAttribute('data-codex-control-console-frame', '');
    frame.setAttribute('allow', 'clipboard-read; clipboard-write');
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:#f7f7f8;';
    const loading = document.createElement('div');
    loading.textContent = module === 'console' ? '正在打开控制台…' : module === 'sessions' ? '正在打开会话中心…' : module === 'priority' ? '正在打开项目优先级…' : '正在打开看板…';
    loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#6b6b6b;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:none;';
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

  function openTask(task) {
    const title = normalize(task?.title);
    const taskId = normalize(task?.id);
    const localThreadId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId) ? taskId : null;
    if (localThreadId) {
      window.postMessage({
        type: 'navigate-to-route',
        path: '/local/' + encodeURIComponent(localThreadId)
      }, '*');
      return { ok: true, method: 'native-route-id', id: localThreadId, title };
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
      button.innerHTML = iconMarkup + '<span>' + definition.text + '</span>';
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openWorkspace(definition.module); });
      rail.append(button);
    }
    document.body.append(rail);
  }

  function installTitlebarEntry() {
    if (!document.body || document.querySelector(TITLEBAR_SESSION_ENTRY_SELECTOR)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(TITLEBAR_SESSION_ENTRY_ATTRIBUTE, '');
    button.setAttribute('aria-label', '打开会话中心');
    button.title = '会话中心';
    button.style.cssText = 'position:fixed;left:200px;top:8px;z-index:2147483000;display:grid;width:28px;height:28px;padding:0;place-items:center;border:0;border-radius:7px;background:transparent;color:rgba(255,255,255,.52);cursor:pointer;-webkit-app-region:no-drag;app-region:no-drag;';
    button.innerHTML = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="2.25" y="2.75" width="13.5" height="12.5" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 6.5h7M5.5 9h7M5.5 11.5h4.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    button.addEventListener('mouseenter', () => { button.style.background = 'rgba(255,255,255,.09)'; button.style.color = 'rgba(255,255,255,.82)'; });
    button.addEventListener('mouseleave', () => { button.style.background = 'transparent'; button.style.color = 'rgba(255,255,255,.52)'; });
    button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openWorkspace('sessions'); });
    document.body.append(button);
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
      entry.innerHTML = iconMarkup + '<span class="truncate">' + definition.text + '</span>';
      entry.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); openWorkspace(definition.module); });
      anchor.parentElement?.insertBefore(entry, insertionPoint);
    }
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || !event.data) return;
    if (event.data.type === 'codex-control-console-open-task') {
      const result = openTask(event.data.task || {});
      postToDashboard({ type: 'codex-control-console-open-task-result', result });
      if (result.ok) restoreWorkspace();
    } else if (event.data.type === 'codex-control-console-close') {
      restoreWorkspace();
    }
  });

  function scheduleInstall() {
    if (observerTimer) clearTimeout(observerTimer);
    observerTimer = setTimeout(() => { installEntry(); installTitlebarEntry(); }, 30);
  }

  function boot() {
    if (window.__codexControlConsoleObserver) return;
    if (!document.documentElement || !document.body) {
      setTimeout(boot, 25);
      return;
    }
    installEntry();
    installTitlebarEntry();
    window.__codexControlConsoleObserver = new MutationObserver(scheduleInstall);
    window.__codexControlConsoleObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  boot();
})();`;
}
