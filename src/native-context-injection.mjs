const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeNativeContextOverrides(items = []) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const threadId = String(item?.threadId || "").trim().toLowerCase();
    const contextWindow = Number(item?.requestedContextWindow);
    if (!THREAD_ID_PATTERN.test(threadId) || !Number.isSafeInteger(contextWindow) || contextWindow < 32_000 || contextWindow > 2_000_000) return [];
    return [{ threadId, contextWindow }];
  });
}

export function normalizeNativeContextAction(item) {
  const action = item?.action === "set" ? "set" : item?.action === "remove" ? "remove" : null;
  const threadId = String(item?.threadId || "").trim().toLowerCase();
  if (!action || !THREAD_ID_PATTERN.test(threadId)) return null;
  if (action === "remove") return { action, threadId };
  const contextWindow = Number(item?.contextWindow);
  if (!Number.isSafeInteger(contextWindow) || contextWindow < 32_000 || contextWindow > 2_000_000) return null;
  return { action, threadId, contextWindow };
}

export function buildNativeContextInjectionScript() {
  return `(() => {
  if (window.__codexControlConsoleNativeContextVersion === '2026-08-30.2') return;
  window.__codexControlConsoleNativeContextObserver?.disconnect?.();
  window.__codexControlConsoleNativeContextVersion = '2026-08-30.2';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const overrides = new Map();
  const actions = [];
  let requestSequence = 0;
  let installTimer = null;

  function request(method, params) {
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') return Promise.reject(new Error('原生会话桥接尚未就绪'));
    const id = 'codex-control-context-' + Date.now() + '-' + (++requestSequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('原生会话请求超时')); }, 8000);
      const receive = (event) => {
        const data = event.data;
        if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data?.message?.id !== id) return;
        cleanup();
        if (data.message.error) reject(new Error(data.message.error.message || '原生会话请求失败'));
        else resolve(data.message.result);
      };
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
      window.addEventListener('message', receive);
      Promise.resolve(bridge.call(window.electronBridge, {
        type: 'mcp-request', hostId: 'local', retainResponse: true,
        request: { id, method, params }
      })).catch((error) => { cleanup(); reject(error); });
    });
  }

  async function resume(threadId, contextWindow = overrides.get(String(threadId || '').toLowerCase()) || null) {
    const normalized = String(threadId || '').toLowerCase();
    const result = await request('thread/resume', {
      threadId: normalized,
      history: null,
      path: null,
      model: null,
      modelProvider: null,
      cwd: null,
      approvalPolicy: null,
      sandbox: null,
      config: contextWindow ? {
        model_context_window: contextWindow,
        model_auto_compact_token_limit: contextWindow
      } : {},
      personality: null,
      excludeTurns: true
    });
    window.__codexControlConsoleLastContextResume = {
      threadId: normalized, contextWindow, mode: contextWindow ? 'extended' : 'default', appliedAt: new Date().toISOString(), ok: true
    };
    return { applied: Boolean(contextWindow), threadId: normalized, contextWindow, result };
  }

  function selectedThreadId() {
    const value = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    return value.startsWith('local:') && UUID.test(value.slice(6)) ? value.slice(6).toLowerCase() : null;
  }

  function styleToggle(button, enabled, pending = false) {
    button.dataset.enabled = enabled ? 'true' : 'false';
    button.disabled = pending;
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = enabled ? '当前会话已启用扩展上下文；点击恢复模型默认' : '点击仅为当前会话启用百万上下文';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border-radius:999px;border:1px solid ' + (enabled ? 'rgba(184,134,11,.46)' : 'rgba(128,128,128,.25)') + ';background:' + (enabled ? 'rgba(234,179,8,.15)' : 'transparent') + ';color:' + (enabled ? '#a47400' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (pending ? 'wait' : 'pointer') + ';opacity:' + (pending ? '.62' : '1') + ';';
    button.innerHTML = '<span aria-hidden="true" style="width:6px;height:6px;border-radius:50%;background:' + (enabled ? '#d9a400' : '#96969b') + '"></span><span>百万上下文</span><small style="font-size:10px;opacity:.78">' + (enabled ? '开' : '关') + '</small>';
  }

  async function toggleCurrent(button) {
    const threadId = selectedThreadId();
    if (!threadId || button.disabled) return;
    const wasEnabled = overrides.has(threadId);
    const enabled = !wasEnabled;
    if (enabled) overrides.set(threadId, 1000000);
    else overrides.delete(threadId);
    styleToggle(button, enabled, true);
    try {
      await resume(threadId, enabled ? 1000000 : null);
      if (actions.length >= 32) actions.shift();
      actions.push(enabled ? { action: 'set', threadId, contextWindow: 1000000 } : { action: 'remove', threadId });
      styleToggle(button, enabled, false);
    } catch (error) {
      if (wasEnabled) overrides.set(threadId, 1000000);
      else overrides.delete(threadId);
      styleToggle(button, wasEnabled, false);
      window.__codexControlConsoleLastContextResume = { threadId, ok: false, message: error.message };
    }
  }

  function installToggle() {
    const threadId = selectedThreadId();
    const existing = document.querySelector('[data-codex-control-console-context-toggle]');
    if (!threadId) { existing?.remove(); return; }
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]');
    const host = permission?.parentElement;
    if (!host) return;
    const button = existing || document.createElement('button');
    if (!existing) {
      button.type = 'button';
      button.setAttribute('data-codex-control-console-context-toggle', '');
      button.setAttribute('aria-label', '百万上下文');
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void toggleCurrent(button); });
    }
    styleToggle(button, overrides.has(threadId), button.disabled);
    if (button.parentElement !== host) host.append(button);
  }

  function scheduleToggle() {
    if (installTimer) clearTimeout(installTimer);
    installTimer = setTimeout(installToggle, 40);
  }

  window.__codexControlConsoleSetContextOverrides = (items) => {
    overrides.clear();
    for (const item of Array.isArray(items) ? items : []) {
      const threadId = String(item?.threadId || '').trim().toLowerCase();
      const contextWindow = Number(item?.contextWindow);
      if (UUID.test(threadId) && Number.isSafeInteger(contextWindow) && contextWindow >= 32000 && contextWindow <= 2000000) {
        overrides.set(threadId, contextWindow);
      }
    }
    scheduleToggle();
    return { count: overrides.size };
  };

  window.__codexControlConsoleDrainContextActions = () => actions.splice(0, actions.length);

  window.__codexControlConsoleOpenNativeThread = async (threadId) => {
    const normalized = String(threadId || '').trim().toLowerCase();
    if (!UUID.test(normalized)) throw new Error('会话 ID 无效');
    const activation = await resume(normalized);
    window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(normalized) }, '*');
    if (activation.applied) setTimeout(() => void resume(normalized).catch(() => {}), 350);
    return activation;
  };

  document.addEventListener('click', (event) => {
    const entry = event.target?.closest?.('[data-app-action-sidebar-thread-id]');
    const value = entry?.getAttribute('data-app-action-sidebar-thread-id') || '';
    const threadId = value.startsWith('local:') ? value.slice(6).toLowerCase() : '';
    if (!overrides.has(threadId)) return;
    setTimeout(() => void resume(threadId).catch((error) => {
      window.__codexControlConsoleLastContextResume = { threadId, ok: false, message: error.message };
    }), 350);
  }, true);

  window.__codexControlConsoleNativeContextObserver = new MutationObserver(scheduleToggle);
  window.__codexControlConsoleNativeContextObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  scheduleToggle();
})();`;
}

export function buildNativeContextSnapshotScript(items) {
  const normalized = normalizeNativeContextOverrides(items);
  return `window.__codexControlConsoleSetContextOverrides?.(${JSON.stringify(normalized)})`;
}
