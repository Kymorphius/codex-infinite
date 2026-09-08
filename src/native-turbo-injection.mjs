import { highestModelEfforts, TURBO_ACCESS_MODES, TURBO_REASONING_MODES } from "./turbo-policy.mjs";
import { buildNativeTurboUiSource } from "./native-turbo-ui.mjs";

export const NATIVE_TURBO_BINDING = "__codexControlConsoleToggleTurbo";

export function parseNativeTurboAction(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const allowed = ["enabled", "model", "reasoningEffort", "fast", "millionContext", "accessMode", "deviceIds"];
  if (!keys.length || keys.some((key) => !allowed.includes(key))) return null;
  if (Object.hasOwn(value, "enabled") && typeof value.enabled !== "boolean") return null;
  if (Object.hasOwn(value, "model") && value.model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(String(value.model))) return null;
  if (Object.hasOwn(value, "reasoningEffort") && !TURBO_REASONING_MODES.includes(value.reasoningEffort)) return null;
  if (Object.hasOwn(value, "fast") && typeof value.fast !== "boolean") return null;
  if (Object.hasOwn(value, "millionContext") && typeof value.millionContext !== "boolean") return null;
  if (Object.hasOwn(value, "accessMode") && !TURBO_ACCESS_MODES.includes(value.accessMode)) return null;
  if (Object.hasOwn(value, "deviceIds") && (!Array.isArray(value.deviceIds) || value.deviceIds.length > 32 || value.deviceIds.some((id) => !/^[A-Za-z0-9_.:-]{1,80}$/.test(String(id))))) return null;
  const action = {};
  for (const key of allowed) if (Object.hasOwn(value, key)) action[key] = key === "deviceIds" ? [...new Set(value[key])] : value[key];
  return Object.freeze(action);
}

export async function applyNativeTurboAction(payload, turboController) {
  const action = parseNativeTurboAction(payload);
  if (!action || typeof turboController?.update !== "function") return null;
  return turboController.update(action);
}

export function normalizeTurboPolicy(policy = {}) {
  policy = policy && typeof policy === "object" ? policy : {};
  const modelEfforts = highestModelEfforts((Array.isArray(policy.modelEfforts) ? policy.modelEfforts : []).map((item) => ({
    id: item.model, reasoningEfforts: [{ effort: item.effort }]
  })));
  const modelOptions = (Array.isArray(policy.modelOptions) ? policy.modelOptions : []).slice(0, 32).map((item) => ({
    id: String(item.id || "").slice(0, 120), efforts: (Array.isArray(item.efforts) ? item.efforts : []).map(String).slice(0, 8)
  })).filter((item) => item.id);
  const devices = (Array.isArray(policy.devices) ? policy.devices : []).slice(0, 32).map((item) => ({ id: String(item.id || "").slice(0, 80), name: String(item.name || item.id || "").slice(0, 120) })).filter((item) => item.id);
  return {
    enabled: policy.enabled === true, active: policy.active !== false, model: typeof policy.model === "string" ? policy.model : null,
    reasoningEffort: TURBO_REASONING_MODES.includes(policy.reasoningEffort) ? policy.reasoningEffort : "maximum",
    fast: policy.fast !== false, millionContext: policy.millionContext === true,
    accessMode: TURBO_ACCESS_MODES.includes(policy.accessMode) ? policy.accessMode : "preserve",
    deviceIds: Array.isArray(policy.deviceIds) ? policy.deviceIds.slice(0, 32).map(String) : [], modelEfforts, modelOptions, devices
  };
}

export function buildNativeTurboInjectionScript() {
  const bindingName = JSON.stringify(NATIVE_TURBO_BINDING);
  const uiSource = buildNativeTurboUiSource(NATIVE_TURBO_BINDING);
  return `(() => {
  if (window.__codexControlConsoleTurboVersion === '2026-08-31.6') return;
  if (window.__codexControlConsoleTurboInstallTimer) clearInterval(window.__codexControlConsoleTurboInstallTimer);
  try {
    const currentSend = window.electronBridge?.sendMessageFromView;
    if (currentSend?.__codexControlTurboOriginal) window.electronBridge.sendMessageFromView = currentSend.__codexControlTurboOriginal;
  } catch {}
  document.querySelector('[data-codex-control-console-native-turbo]')?.remove();
  document.querySelector('[data-codex-control-console-native-turbo-settings]')?.remove();
  document.querySelector('[data-codex-control-console-turbo-popover]')?.remove();
  document.querySelector('[data-codex-control-console-turbo-effective]')?.remove();
  window.__codexControlConsoleTurboVersion = '2026-08-31.6';
  let policy = { enabled: false, active: false, model: null, reasoningEffort: 'maximum', fast: true, millionContext: false, accessMode: 'preserve', deviceIds: [], efforts: new Map(), modelOptions: [], devices: [] };
  let installTimer = null;
  let pending = false;
  let requestSequence = 0;
  const affectedStorageKey = 'codex-control-console-turbo-context-threads';
  let affectedContextThreads = new Set();
  try {
    const stored = JSON.parse(localStorage.getItem(affectedStorageKey) || '[]');
    affectedContextThreads = new Set((Array.isArray(stored) ? stored : []).filter((id) => /^[0-9a-f-]{36}$/.test(String(id))).slice(0, 256));
  } catch {}

  function clone(value) { return value && typeof value === 'object' ? { ...value } : value; }

  function persistAffectedThreads() {
    try { localStorage.setItem(affectedStorageKey, JSON.stringify(Array.from(affectedContextThreads).slice(-256))); } catch {}
  }

  function resumeContext(originalSend, threadId, contextWindow) {
    const id = 'codex-control-turbo-context-' + Date.now() + '-' + (++requestSequence);
    const config = {};
    if (contextWindow) {
      config.model_context_window = contextWindow;
      config.model_auto_compact_token_limit = contextWindow;
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Turbo 上下文设置超时')); }, 8000);
      const receive = (event) => {
        const data = event.data;
        if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data?.message?.id !== id) return;
        cleanup();
        if (data.message.error) reject(new Error(data.message.error.message || 'Turbo 上下文设置失败'));
        else resolve(data.message.result);
      };
      const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', receive); };
      window.addEventListener('message', receive);
      Promise.resolve(originalSend({
        type: 'mcp-request', hostId: 'local', retainResponse: true,
        request: { id, method: 'thread/resume', params: { threadId, history: null, path: null, config, excludeTurns: true } }
      })).catch((error) => { cleanup(); reject(error); });
    });
  }

  async function prepareTurboContext(originalSend, message) {
    const params = message?.type === 'mcp-request' && message?.hostId === 'local' && message?.request?.method === 'turn/start' ? message.request.params : null;
    const threadId = typeof params?.threadId === 'string' ? params.threadId.toLowerCase() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(threadId)) return;
    const shouldExtend = policy.enabled && policy.active && policy.millionContext;
    if (!shouldExtend && !affectedContextThreads.has(threadId)) return;
    const ordinaryWindow = Number(window.__codexControlConsoleGetContextWindow?.(threadId)) || null;
    const contextWindow = shouldExtend ? 1000000 : ordinaryWindow;
    try {
      await resumeContext(originalSend, threadId, contextWindow);
      if (shouldExtend) affectedContextThreads.add(threadId); else affectedContextThreads.delete(threadId);
      persistAffectedThreads();
      window.__codexControlConsoleLastTurboContext = { ok: true, threadId, contextWindow, restored: !shouldExtend, appliedAt: new Date().toISOString() };
    } catch (error) {
      window.__codexControlConsoleLastTurboContext = { ok: false, threadId, contextWindow, message: String(error?.message || error), appliedAt: new Date().toISOString() };
    }
  }

  function transform(message) {
    const request = message?.type === 'mcp-request' && message?.hostId === 'local' ? message.request : null;
    const params = request?.method === 'turn/start' ? request.params : null;
    const threadId = typeof params?.threadId === 'string' ? params.threadId.toLowerCase() : '';
    if (!policy.enabled || !policy.active || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(threadId)) return message;
    const collaborationMode = params.collaborationMode && typeof params.collaborationMode === 'object' ? clone(params.collaborationMode) : null;
    const collaborationSettings = collaborationMode?.settings && typeof collaborationMode.settings === 'object' ? clone(collaborationMode.settings) : null;
    const nativeModel = String(params.model || collaborationSettings?.model || '');
    const model = policy.model || nativeModel;
    const effort = policy.reasoningEffort === 'preserve' ? null : policy.reasoningEffort === 'maximum' ? policy.efforts.get(model) : policy.reasoningEffort;
    const nextParams = { ...params };
    let nextCollaborationSettings = collaborationSettings;
    if (policy.model && collaborationMode && collaborationSettings) nextCollaborationSettings = { ...nextCollaborationSettings, model };
    else if (policy.model) nextParams.model = model;
    if (effort && collaborationMode && nextCollaborationSettings) nextCollaborationSettings = { ...nextCollaborationSettings, reasoning_effort: effort };
    else if (effort) nextParams.effort = effort;
    if (collaborationMode && nextCollaborationSettings !== collaborationSettings) nextParams.collaborationMode = { ...collaborationMode, settings: nextCollaborationSettings };
    if (policy.fast) nextParams.serviceTierForTurn = 'priority';
    const permissionProfiles = { 'read-only': ':read-only', workspace: ':workspace', 'full-access': ':danger-full-access' };
    if (permissionProfiles[policy.accessMode]) nextParams.permissions = permissionProfiles[policy.accessMode];
    return { ...message, request: { ...request, params: nextParams } };
  }

  ${uiSource}

  function install() {
    installButton();
    decorateReasoningControl();
    const bridge = window.electronBridge;
    const current = bridge?.sendMessageFromView;
    if (typeof current !== 'function' || current.__codexControlTurboWrapped) return;
    const originalSend = current.bind(bridge);
    const wrapped = async function(message) {
      await prepareTurboContext(originalSend, message);
      return originalSend(transform(message));
    };
    wrapped.__codexControlTurboWrapped = true;
    wrapped.__codexControlTurboOriginal = current;
    try { bridge.sendMessageFromView = wrapped; } catch {}
  }

  window.__codexControlConsoleSetTurboPolicy = (value) => {
    policy = {
      enabled: value?.enabled === true,
      active: value?.active !== false,
      model: typeof value?.model === 'string' ? value.model : null,
      reasoningEffort: typeof value?.reasoningEffort === 'string' ? value.reasoningEffort : 'maximum',
      fast: value?.fast !== false,
      millionContext: value?.millionContext === true,
      accessMode: typeof value?.accessMode === 'string' ? value.accessMode : 'preserve',
      deviceIds: Array.isArray(value?.deviceIds) ? value.deviceIds.map(String) : [],
      efforts: new Map((Array.isArray(value?.modelEfforts) ? value.modelEfforts : []).map((item) => [String(item.model), String(item.effort)])),
      modelOptions: Array.isArray(value?.modelOptions) ? value.modelOptions : [],
      devices: Array.isArray(value?.devices) ? value.devices : []
    };
    pending = false;
    install();
    return { enabled: policy.enabled, active: policy.active, model: policy.model, reasoningEffort: policy.reasoningEffort, fast: policy.fast, millionContext: policy.millionContext, accessMode: policy.accessMode, deviceCount: policy.deviceIds.length, modelCount: policy.efforts.size };
  };
  install();
  installTimer = setInterval(install, 1000);
  window.__codexControlConsoleTurboInstallTimer = installTimer;
  window.addEventListener('beforeunload', () => {
    clearInterval(installTimer);
    if (window.__codexControlConsoleTurboInstallTimer === installTimer) window.__codexControlConsoleTurboInstallTimer = null;
  }, { once: true });
})()`;
}

export function buildNativeTurboSnapshotScript(policy) {
  return `window.__codexControlConsoleSetTurboPolicy?.(${JSON.stringify(normalizeTurboPolicy(policy))}) || null`;
}
