const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeNativeContextOverrides(items = []) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const threadId = String(item?.threadId || "").trim().toLowerCase();
    const contextWindow = Number(item?.requestedContextWindow);
    if (!THREAD_ID_PATTERN.test(threadId) || !Number.isSafeInteger(contextWindow) || contextWindow < 32_000 || contextWindow > 2_000_000) return [];
    return [{ threadId, contextWindow }];
  });
}

export function buildNativeContextInjectionScript() {
  return `(() => {
  if (window.__codexControlConsoleNativeContextVersion === '2026-08-30.1') return;
  window.__codexControlConsoleNativeContextVersion = '2026-08-30.1';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const overrides = new Map();
  let requestSequence = 0;

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

  async function resume(threadId) {
    const normalized = String(threadId || '').toLowerCase();
    const contextWindow = overrides.get(normalized);
    if (!contextWindow) return { applied: false, threadId: normalized };
    const result = await request('thread/resume', {
      threadId: normalized,
      history: null,
      path: null,
      model: null,
      modelProvider: null,
      cwd: null,
      approvalPolicy: null,
      sandbox: null,
      config: {
        model_context_window: contextWindow,
        model_auto_compact_token_limit: contextWindow
      },
      personality: null,
      excludeTurns: true
    });
    window.__codexControlConsoleLastContextResume = {
      threadId: normalized, contextWindow, appliedAt: new Date().toISOString(), ok: true
    };
    return { applied: true, threadId: normalized, contextWindow, result };
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
    return { count: overrides.size };
  };

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
})();`;
}

export function buildNativeContextSnapshotScript(items) {
  const normalized = normalizeNativeContextOverrides(items);
  return `window.__codexControlConsoleSetContextOverrides?.(${JSON.stringify(normalized)})`;
}
