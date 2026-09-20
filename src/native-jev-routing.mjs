const MAX_PROMPT_BYTES = 128 * 1024;
const ROUTE_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]);
const ROUTE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NATIVE_JEV_ROUTING_BINDING = "__codexControlConsoleJevRouting";

export function parseNativeJevRoutingRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(value.id || ""))) return null;
  if (value.kind === "set-enabled" && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, enabled: value.enabled };
  if (value.kind === "set-thread-enabled" && THREAD_ID_PATTERN.test(String(value.threadId || "")) && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, threadId: String(value.threadId).toLowerCase(), enabled: value.enabled };
  if (value.kind !== "classify" || typeof value.prompt !== "string") return null;
  const prompt = value.prompt.trim();
  if (!prompt || Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) return null;
  return { id: String(value.id), kind: value.kind, prompt };
}

export async function handleNativeJevRoutingRequest(payload, service) {
  const request = parseNativeJevRoutingRequest(payload);
  if (!request || !service) return null;
  try {
    if (request.kind === "set-enabled") {
      await service.setEnabled(request.enabled);
      return { id: request.id, kind: request.kind, ok: true, snapshot: await service.snapshot() };
    }
    if (request.kind === "set-thread-enabled") {
      return { id: request.id, kind: request.kind, ok: true, snapshot: await service.setThreadEnabled(request.threadId, request.enabled) };
    }
    const classification = await service.classifyCurrent(request.prompt);
    return { id: request.id, kind: request.kind, ok: true, classification };
  } catch (error) {
    return { id: request.id, kind: request.kind, ok: false, message: String(error?.message || error).slice(0, 500) };
  }
}

export function buildNativeJevRoutingResponseScript(response) {
  return `window.__codexControlConsoleResolveJevRouting?.(${JSON.stringify(response ?? null)})`;
}

export async function respondToNativeJevRoutingBinding(payload, connection, service) {
  const response = await handleNativeJevRoutingRequest(payload, service);
  if (response) await connection.evaluate(buildNativeJevRoutingResponseScript(response));
  return response;
}

export function normalizeNativeJevRoutingSnapshot(snapshot = {}) {
  if (!snapshot?.config || typeof snapshot.config !== "object") {
    return { enabled: false, available: false, fallbackTier: "everyday", mappings: {}, threadOverrides: {} };
  }
  const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
  const mappings = {};
  for (const [tier, value] of Object.entries(config.mappings || {})) {
    if (!/^[a-z]{1,24}$/.test(tier) || !ROUTE_MODELS.has(value?.model) || !ROUTE_EFFORTS.has(value?.effort)) continue;
    mappings[tier] = { model: value.model, effort: value.effort };
  }
  const threadOverrides = {};
  for (const [rawThreadId, enabled] of Object.entries(snapshot.threadOverrides || {})) {
    const threadId = String(rawThreadId).toLowerCase();
    if (THREAD_ID_PATTERN.test(threadId) && typeof enabled === "boolean") threadOverrides[threadId] = enabled;
  }
  return {
    enabled: config.enabled !== false,
    available: snapshot?.available === true,
    fallbackTier: typeof config.fallbackTier === "string" ? config.fallbackTier : "everyday",
    mappings,
    threadOverrides
  };
}

export function buildNativeJevRoutingSnapshotScript(snapshot) {
  return `window.__codexControlConsoleSetJevRouting?.(${JSON.stringify(normalizeNativeJevRoutingSnapshot(snapshot))}) || null`;
}

export function buildNativeJevRoutingInjectionScript() {
  const binding = JSON.stringify(NATIVE_JEV_ROUTING_BINDING);
  return `(() => {
  if (window.__codexControlConsoleJevRoutingVersion === '2026-09-20.2') return;
  if (window.__codexControlConsoleJevRoutingInstallTimer) clearInterval(window.__codexControlConsoleJevRoutingInstallTimer);
  document.querySelector('[data-codex-control-console-native-jev]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev-current]')?.remove();
  window.__codexControlConsoleJevRoutingVersion = '2026-09-20.2';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let policy = { enabled: false, available: false, fallbackTier: 'everyday', mappings: {}, threadOverrides: {} };
  let lastResult = null;
  let sequence = 0;
  let togglePending = false;
  const pending = new Map();

  function request(kind, body, timeoutMs) {
    const bindingFn = window[${binding}];
    if (typeof bindingFn !== 'function') return Promise.reject(new Error('Jev 原生桥不可用'));
    const id = 'jev-native-' + Date.now() + '-' + (++sequence);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Jev 原生判断超时')); }, timeoutMs);
      pending.set(id, { resolve, reject, timeout });
      try { bindingFn(JSON.stringify({ id, kind, ...body })); }
      catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
    });
  }

  window.__codexControlConsoleResolveJevRouting = (response) => {
    const waiter = pending.get(String(response?.id || ''));
    if (!waiter) return false;
    pending.delete(String(response.id)); clearTimeout(waiter.timeout);
    if (response.ok) waiter.resolve(response); else waiter.reject(new Error(response.message || 'Jev 原生判断失败'));
    return true;
  };

  function promptFrom(params) {
    const text = (Array.isArray(params?.input) ? params.input : []).map((item) => {
      if (!item || typeof item !== 'object') return '';
      if (typeof item.text === 'string') return item.text;
      if (typeof item.content === 'string') return item.content;
      return '';
    }).filter(Boolean).join('\\n').trim();
    return text.slice(0, 131072);
  }

  function fallbackClassification(reason) {
    const tier = policy.fallbackTier;
    const mapping = policy.mappings[tier];
    return mapping ? { tier, confidence: null, fallback: true, reason, ...mapping } : null;
  }

  function currentThreadId() {
    const mounted = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
    if (UUID.test(mounted)) return mounted.toLowerCase();
    const selected = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"],[data-app-action-sidebar-thread-selected="true"]');
    const value = selected?.getAttribute('data-app-action-sidebar-thread-id') || '';
    return value.startsWith('local:') && UUID.test(value.slice(6)) ? value.slice(6).toLowerCase() : null;
  }

  function effectiveEnabled(threadId) {
    return threadId && Object.prototype.hasOwnProperty.call(policy.threadOverrides, threadId) ? policy.threadOverrides[threadId] : policy.enabled;
  }

  function transform(message, classification) {
    if (!classification || !classification.model || !classification.effort) return message;
    const request = message?.request;
    const params = request?.params;
    const collaborationMode = params?.collaborationMode && typeof params.collaborationMode === 'object' ? { ...params.collaborationMode } : null;
    const collaborationSettings = collaborationMode?.settings && typeof collaborationMode.settings === 'object' ? { ...collaborationMode.settings } : null;
    const nextParams = { ...params };
    if (collaborationMode && collaborationSettings) {
      nextParams.collaborationMode = { ...collaborationMode, settings: { ...collaborationSettings, model: classification.model, reasoning_effort: classification.effort } };
    } else {
      nextParams.model = classification.model;
      nextParams.effort = classification.effort;
    }
    return { ...message, request: { ...request, params: nextParams } };
  }

  function buttonHost() {
    const search = document.querySelector('button[aria-label="搜索"],button[aria-label="Search"]');
    return search?.parentElement?.parentElement?.parentElement || null;
  }

  function renderGlobalButton(button) {
    const active = policy.enabled;
    button.dataset.enabled = String(active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Jev 自动分流已开启' : 'Jev 自动分流已关闭');
    button.disabled = togglePending;
    button.textContent = 'Jev 全局';
    button.title = togglePending ? '正在统一所有会话的自动分流设置…' : active ? '统一开启：所有未单独设置的会话自动分流；点击关闭并清除会话覆盖' : '统一关闭：所有未单独设置的会话不自动分流；点击开启并清除会话覆盖';
    button.style.cssText = 'display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.24)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '.88') + ';-webkit-app-region:no-drag;app-region:no-drag;';
  }

  function renderCurrentButton(button) {
    const threadId = currentThreadId();
    const active = effectiveEnabled(threadId);
    const overridden = Boolean(threadId && Object.prototype.hasOwnProperty.call(policy.threadOverrides, threadId));
    button.dataset.enabled = String(active); button.dataset.threadId = threadId || ''; button.dataset.override = String(overridden);
    button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', active ? '当前会话 Jev 自动分流已开启' : '当前会话 Jev 自动分流已关闭'); button.disabled = togglePending || !threadId;
    const suffix = active && lastResult?.tier ? ' · ' + String(lastResult.tier).replace(/^./, (value) => value.toUpperCase()) : '';
    button.textContent = 'Jev 自动' + suffix;
    button.title = !threadId ? '当前没有可设置的原生会话' : togglePending ? '正在保存当前会话设置…' : (overridden ? '当前会话单独' : '继承全局') + (active ? '开启；点击只关闭当前会话' : '关闭；点击只开启当前会话');
    button.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 9px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.25)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '1') + ';-webkit-app-region:no-drag;app-region:no-drag;';
  }

  function applySnapshot(snapshot) {
    const value = snapshot || {};
    const config = value.config || value;
    policy = { enabled: config?.enabled !== false, available: value?.available === true || policy.available, fallbackTier: String(config?.fallbackTier || 'everyday'), mappings: config?.mappings && typeof config.mappings === 'object' ? config.mappings : {}, threadOverrides: value?.threadOverrides && typeof value.threadOverrides === 'object' ? value.threadOverrides : {} };
  }

  function installButtons() {
    const host = buttonHost();
    if (host && host.classList?.contains('ms-auto')) host.parentElement?.setAttribute('data-codex-control-console-interactive-header', '');
    let button = document.querySelector('[data-codex-control-console-native-jev]');
    if (host && !button) {
      button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-codex-control-console-native-jev', '');
      button.addEventListener('click', async (event) => {
        event.preventDefault(); event.stopPropagation(); if (togglePending) return;
        togglePending = true; renderGlobalButton(button); const current = document.querySelector('[data-codex-control-console-native-jev-current]'); if (current) renderCurrentButton(current);
        try {
          const response = await request('set-enabled', { enabled: !policy.enabled }, 8000);
          applySnapshot(response.snapshot); lastResult = null;
        } catch (error) { button.title = String(error?.message || error); }
        finally { togglePending = false; renderGlobalButton(button); if (current) renderCurrentButton(current); }
      });
    }
    if (host && button) { renderGlobalButton(button); if (button.parentElement !== host) host.insertBefore(button, host.firstChild); }

    const threadId = currentThreadId(); const permission = document.querySelector('[data-composer-navigation-target="permissions"]'); const composerHost = permission?.parentElement;
    let current = document.querySelector('[data-codex-control-console-native-jev-current]');
    if (!threadId || !composerHost) { current?.remove(); return; }
    if (!current) {
      current = document.createElement('button'); current.type = 'button'; current.setAttribute('data-codex-control-console-native-jev-current', '');
      current.addEventListener('click', async (event) => {
        event.preventDefault(); event.stopPropagation(); const selectedThreadId = currentThreadId(); if (togglePending || !selectedThreadId) return;
        togglePending = true; renderCurrentButton(current); if (button) renderGlobalButton(button);
        try { const response = await request('set-thread-enabled', { threadId: selectedThreadId, enabled: !effectiveEnabled(selectedThreadId) }, 8000); applySnapshot(response.snapshot); lastResult = null; }
        catch (error) { current.title = String(error?.message || error); }
        finally { togglePending = false; renderCurrentButton(current); if (button) renderGlobalButton(button); }
      });
    }
    renderCurrentButton(current);
    const context = composerHost.querySelector('[data-codex-control-console-context-toggle]');
    if (context) context.after(current); else permission.after(current);
  }

  window.__codexControlConsoleRouteNativeTurn = async (message) => {
    const requestValue = message?.type === 'mcp-request' && message?.hostId === 'local' ? message.request : null;
    const params = requestValue?.method === 'turn/start' ? requestValue.params : null;
    if (!params || !effectiveEnabled(String(params.threadId || '').toLowerCase())) return message;
    const prompt = promptFrom(params);
    try {
      const classification = prompt ? (await request('classify', { prompt }, 22000)).classification : fallbackClassification('当前轮次没有文本，已使用兜底档位');
      if (!classification) return message;
      lastResult = classification; const button = document.querySelector('[data-codex-control-console-native-jev]'); const current = document.querySelector('[data-codex-control-console-native-jev-current]'); if (button) renderGlobalButton(button); if (current) renderCurrentButton(current);
      window.__codexControlConsoleLastJevRouting = { ok: true, ...classification, appliedAt: new Date().toISOString() };
      return transform(message, classification);
    } catch (error) {
      window.__codexControlConsoleLastJevRouting = { ok: false, message: String(error?.message || error), appliedAt: new Date().toISOString() };
      return message;
    }
  };

  window.__codexControlConsoleSetJevRouting = (value) => {
    applySnapshot({ config: value, available: value?.available, threadOverrides: value?.threadOverrides });
    togglePending = false; installButtons();
    return { enabled: policy.enabled, available: policy.available, fallbackTier: policy.fallbackTier };
  };
  installButtons();
  const timer = setInterval(installButtons, 1000); window.__codexControlConsoleJevRoutingInstallTimer = timer;
  window.addEventListener('beforeunload', () => { clearInterval(timer); for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('页面已关闭')); } pending.clear(); }, { once: true });
})()`;
}
