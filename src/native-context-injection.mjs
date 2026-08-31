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

export const NATIVE_CONTEXT_BINDING = "__codexControlConsolePersistContext";

export function buildNativeContextInjectionScript() {
  const bindingName = JSON.stringify(NATIVE_CONTEXT_BINDING);
  return `(() => {
  if (window.__codexControlConsoleNativeContextVersion === '2026-08-31.10') return;
  window.__codexControlConsoleNativeContextObserver?.disconnect?.();
  document.querySelector('[data-codex-control-console-context-toggle]')?.remove();
  window.__codexControlConsoleNativeContextVersion = '2026-08-31.10';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const overrides = new Map();
  const actions = [];
  let requestSequence = 0;
  let installTimer = null;

  function persistAction(action) {
    const binding = window[${bindingName}];
    if (typeof binding === 'function') binding(JSON.stringify(action));
    else {
      if (actions.length >= 32) actions.shift();
      actions.push(action);
    }
  }

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

  async function resume(threadId, settings = {}) {
    const normalized = String(threadId || '').toLowerCase();
    const hasContextWindow = Object.prototype.hasOwnProperty.call(settings, 'contextWindow');
    const contextWindow = hasContextWindow ? settings.contextWindow : overrides.get(normalized) || null;
    const config = {};
    if (contextWindow) {
      config.model_context_window = contextWindow;
      config.model_auto_compact_token_limit = contextWindow;
    }
    if (settings.reasoningEffort) config.model_reasoning_effort = settings.reasoningEffort;
    const params = {
      threadId: normalized,
      history: null,
      path: null,
      config,
      excludeTurns: true
    };
    if (settings.model) params.model = settings.model;
    if (settings.serviceTier) params.serviceTier = settings.serviceTier;
    if (settings.permissionProfile) params.permissions = settings.permissionProfile;
    const result = await request('thread/resume', params);
    window.__codexControlConsoleLastContextResume = {
      threadId: normalized, contextWindow, mode: contextWindow ? 'extended' : 'default', appliedAt: new Date().toISOString(), ok: true
    };
    return { applied: Boolean(contextWindow), threadId: normalized, contextWindow, result };
  }

  async function updateThreadSettings(params) {
    try {
      return await request('thread/settings/update', params);
    } catch (error) {
      if (!/thread not found/i.test(String(error?.message || ''))) throw error;
      await resume(params.threadId);
      return request('thread/settings/update', params);
    }
  }

  function selectedThreadId() {
    const value = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    return value.startsWith('local:') && UUID.test(value.slice(6)) ? value.slice(6).toLowerCase() : null;
  }

  function styleToggle(button, threadId, enabled, pending = false) {
    const renderState = threadId + ':' + (enabled ? 'on' : 'off') + ':' + (pending ? 'pending' : 'ready');
    if (button.dataset.renderState === renderState) return;
    button.dataset.renderState = renderState;
    button.dataset.threadId = threadId;
    button.dataset.enabled = enabled ? 'true' : 'false';
    button.disabled = pending;
    button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    button.title = enabled ? '当前会话已启用扩展上下文；点击恢复模型默认' : '点击仅为当前会话启用百万上下文';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border-radius:999px;border:1px solid ' + (enabled ? 'rgba(184,134,11,.46)' : 'rgba(128,128,128,.25)') + ';background:' + (enabled ? 'rgba(234,179,8,.15)' : 'transparent') + ';color:' + (enabled ? '#a47400' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (pending ? 'wait' : 'pointer') + ';opacity:' + (pending ? '.62' : '1') + ';';
    const dot = button.querySelector('[data-context-toggle-dot]');
    const status = button.querySelector('[data-context-toggle-status]');
    if (dot) dot.style.background = enabled ? '#d9a400' : '#96969b';
    if (status) status.textContent = enabled ? '开' : '关';
  }

  async function toggleCurrent(button) {
    const threadId = selectedThreadId();
    if (!threadId || button.disabled) return;
    const wasEnabled = overrides.has(threadId);
    const enabled = !wasEnabled;
    if (enabled) overrides.set(threadId, 1000000);
    else overrides.delete(threadId);
    styleToggle(button, threadId, enabled, true);
    try {
      await resume(threadId, { contextWindow: enabled ? 1000000 : null });
      persistAction(enabled ? { action: 'set', threadId, contextWindow: 1000000 } : { action: 'remove', threadId });
      styleToggle(button, threadId, enabled, false);
    } catch (error) {
      if (wasEnabled) overrides.set(threadId, 1000000);
      else overrides.delete(threadId);
      styleToggle(button, threadId, wasEnabled, false);
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
      button.innerHTML = '<span data-context-toggle-dot aria-hidden="true" style="width:6px;height:6px;border-radius:50%"></span><span>百万上下文</span><small data-context-toggle-status style="font-size:10px;opacity:.78"></small>';
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void toggleCurrent(button); });
    }
    styleToggle(button, threadId, overrides.has(threadId), button.disabled);
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

  window.__codexControlConsoleApplyThreadSettings = async (threadId, changes) => {
    const normalized = String(threadId || '').trim().toLowerCase();
    if (!UUID.test(normalized) || !changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('会话设置变更无效');
    const settings = {};
    if (Object.prototype.hasOwnProperty.call(changes, 'model')) {
      const model = String(changes.model || '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model)) throw new Error('模型无效');
      settings.model = model;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'reasoningEffort')) {
      const effort = String(changes.reasoningEffort || '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(effort)) throw new Error('推理强度无效');
      settings.reasoningEffort = effort;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'serviceTier')) {
      const serviceTier = String(changes.serviceTier || '').trim().toLowerCase();
      if (!['default', 'priority', 'ultrafast'].includes(serviceTier)) throw new Error('推理速度无效');
      settings.serviceTier = serviceTier;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'permissionProfile')) {
      const permissionProfile = String(changes.permissionProfile || '').trim();
      if (![':read-only', ':workspace', ':danger-full-access'].includes(permissionProfile)) throw new Error('访问权限无效');
      settings.permissionProfile = permissionProfile;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'contextWindow')) {
      const contextWindow = changes.contextWindow;
      if (contextWindow !== null && (!Number.isSafeInteger(contextWindow) || contextWindow < 32000 || contextWindow > 2000000)) throw new Error('上下文窗口无效');
      settings.contextWindow = contextWindow;
    }
    if (!Object.keys(settings).length) throw new Error('会话设置变更为空');
    const update = { threadId: normalized };
    if (settings.model) update.model = settings.model;
    if (settings.reasoningEffort) update.effort = settings.reasoningEffort;
    if (settings.serviceTier) update.serviceTier = settings.serviceTier;
    if (settings.permissionProfile) update.permissions = settings.permissionProfile;
    const results = {};
    if (Object.keys(update).length > 1) results.settings = await updateThreadSettings(update);
    if (Object.prototype.hasOwnProperty.call(settings, 'contextWindow')) results.context = await resume(normalized, settings);
    if (Object.prototype.hasOwnProperty.call(settings, 'contextWindow')) {
      if (settings.contextWindow) overrides.set(normalized, settings.contextWindow);
      else overrides.delete(normalized);
      scheduleToggle();
    }
    window.__codexControlConsoleLastThreadSettings = { threadId: normalized, settings, appliedAt: new Date().toISOString(), ok: true };
    return { applied: true, threadId: normalized, settings, results };
  };

  window.__codexControlConsoleInterruptThread = async (threadId, turnId) => {
    const normalizedThread = String(threadId || '').trim().toLowerCase();
    const normalizedTurn = String(turnId || '').trim().toLowerCase();
    if (!UUID.test(normalizedThread) || !UUID.test(normalizedTurn)) throw new Error('会话或执行轮次 ID 无效');
    await request('turn/interrupt', { threadId: normalizedThread, turnId: normalizedTurn });
    return { interrupted: true, threadId: normalizedThread, turnId: normalizedTurn };
  };

  window.__codexControlConsoleReadThreadStatuses = async () => {
    const output = [];
    let cursor = null;
    let pageCount = 0;
    do {
      const page = await request('thread/list', {
        cursor, limit: 100, sortKey: 'updated_at', sortDirection: 'desc',
        archived: false, cwd: null, sourceKinds: [], providerNames: [], searchTerm: null,
        projectId: null, projectKind: null, scanMode: 'stateDbOnly'
      });
      if (!Array.isArray(page?.data)) break;
      for (const thread of page.data) output.push({ id: thread?.id, status: thread?.status });
      cursor = page.nextCursor || null;
      pageCount += 1;
    } while (cursor && pageCount < 10);
    return output;
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
