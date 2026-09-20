const MAX_PROMPT_BYTES = 128 * 1024;
const ROUTE_MODELS = new Set(["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"]);
const ROUTE_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);

export const NATIVE_JEV_ROUTING_BINDING = "__codexControlConsoleJevRouting";

export function parseNativeJevRoutingRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(String(value.id || ""))) return null;
  if (value.kind === "set-enabled" && typeof value.enabled === "boolean") return { id: String(value.id), kind: value.kind, enabled: value.enabled };
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
      return { id: request.id, kind: request.kind, ok: true, config: await service.setEnabled(request.enabled) };
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
    return { enabled: false, available: false, fallbackTier: "everyday", mappings: {} };
  }
  const config = snapshot?.config && typeof snapshot.config === "object" ? snapshot.config : {};
  const mappings = {};
  for (const [tier, value] of Object.entries(config.mappings || {})) {
    if (!/^[a-z]{1,24}$/.test(tier) || !ROUTE_MODELS.has(value?.model) || !ROUTE_EFFORTS.has(value?.effort)) continue;
    mappings[tier] = { model: value.model, effort: value.effort };
  }
  return {
    enabled: config.enabled !== false,
    available: snapshot?.available === true,
    fallbackTier: typeof config.fallbackTier === "string" ? config.fallbackTier : "everyday",
    mappings
  };
}

export function buildNativeJevRoutingSnapshotScript(snapshot) {
  return `window.__codexControlConsoleSetJevRouting?.(${JSON.stringify(normalizeNativeJevRoutingSnapshot(snapshot))}) || null`;
}

export function buildNativeJevRoutingInjectionScript() {
  const binding = JSON.stringify(NATIVE_JEV_ROUTING_BINDING);
  return `(() => {
  if (window.__codexControlConsoleJevRoutingVersion === '2026-09-20.1') return;
  if (window.__codexControlConsoleJevRoutingInstallTimer) clearInterval(window.__codexControlConsoleJevRoutingInstallTimer);
  document.querySelector('[data-codex-control-console-native-jev]')?.remove();
  window.__codexControlConsoleJevRoutingVersion = '2026-09-20.1';
  let policy = { enabled: false, available: false, fallbackTier: 'everyday', mappings: {} };
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

  function renderButton(button) {
    const active = policy.enabled;
    button.dataset.enabled = String(active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Jev 自动分流已开启' : 'Jev 自动分流已关闭');
    button.disabled = togglePending;
    const suffix = active && lastResult?.tier ? ' · ' + String(lastResult.tier).replace(/^./, (value) => value.toUpperCase()) : '';
    button.textContent = 'Jev 自动' + suffix;
    button.title = togglePending ? '正在保存自动分流开关…' : active && lastResult ? (lastResult.tier + ' → ' + lastResult.model + ' · ' + lastResult.effort + '；点击关闭') : active ? '已开启：原生 Codex 每一轮发送前自动选择模型与推理强度；点击关闭' : '已关闭：点击开启原生对话自动分流';
    button.style.cssText = 'display:inline-flex;align-items:center;height:24px;padding:0 8px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.24)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '.88') + ';-webkit-app-region:no-drag;app-region:no-drag;';
  }

  function installButton() {
    const host = buttonHost();
    if (!host || !host.classList?.contains('ms-auto')) return;
    host.parentElement?.setAttribute('data-codex-control-console-interactive-header', '');
    let button = document.querySelector('[data-codex-control-console-native-jev]');
    if (!button) {
      button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-codex-control-console-native-jev', '');
      button.addEventListener('click', async (event) => {
        event.preventDefault(); event.stopPropagation(); if (togglePending) return;
        togglePending = true; renderButton(button);
        try {
          const response = await request('set-enabled', { enabled: !policy.enabled }, 8000);
          policy = { ...policy, ...response.config }; lastResult = null;
        } catch (error) { button.title = String(error?.message || error); }
        finally { togglePending = false; renderButton(button); }
      });
    }
    renderButton(button); if (button.parentElement !== host) host.insertBefore(button, host.firstChild);
  }

  window.__codexControlConsoleRouteNativeTurn = async (message) => {
    const requestValue = message?.type === 'mcp-request' && message?.hostId === 'local' ? message.request : null;
    const params = requestValue?.method === 'turn/start' ? requestValue.params : null;
    if (!policy.enabled || !params) return message;
    const prompt = promptFrom(params);
    try {
      const classification = prompt ? (await request('classify', { prompt }, 22000)).classification : fallbackClassification('当前轮次没有文本，已使用兜底档位');
      if (!classification) return message;
      lastResult = classification; const button = document.querySelector('[data-codex-control-console-native-jev]'); if (button) renderButton(button);
      window.__codexControlConsoleLastJevRouting = { ok: true, ...classification, appliedAt: new Date().toISOString() };
      return transform(message, classification);
    } catch (error) {
      window.__codexControlConsoleLastJevRouting = { ok: false, message: String(error?.message || error), appliedAt: new Date().toISOString() };
      return message;
    }
  };

  window.__codexControlConsoleSetJevRouting = (value) => {
    policy = { enabled: value?.enabled !== false, available: value?.available === true, fallbackTier: String(value?.fallbackTier || 'everyday'), mappings: value?.mappings && typeof value.mappings === 'object' ? value.mappings : {} };
    togglePending = false; installButton();
    return { enabled: policy.enabled, available: policy.available, fallbackTier: policy.fallbackTier };
  };
  installButton();
  const timer = setInterval(installButton, 1000); window.__codexControlConsoleJevRoutingInstallTimer = timer;
  window.addEventListener('beforeunload', () => { clearInterval(timer); for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('页面已关闭')); } pending.clear(); }, { once: true });
})()`;
}
