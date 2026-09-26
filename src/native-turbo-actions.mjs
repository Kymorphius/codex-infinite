import { TURBO_ACCESS_MODES, TURBO_REASONING_MODES } from "./turbo-policy.mjs";
import { isTurboQuotaThreshold } from "./turbo-quota-policy.mjs";

export function parseNativeTurboAction(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const allowed = ["enabled", "model", "reasoningEffort", "fast", "millionContext", "autoDisableGlobalRouting", "autoDisableOnLowQuota", "quotaRemainingThreshold", "accessMode", "deviceIds"];
  if (!keys.length || keys.some((key) => !allowed.includes(key))) return null;
  if (Object.hasOwn(value, "enabled") && typeof value.enabled !== "boolean") return null;
  if (Object.hasOwn(value, "model") && value.model !== null && (typeof value.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value.model))) return null;
  if (Object.hasOwn(value, "reasoningEffort") && !TURBO_REASONING_MODES.includes(value.reasoningEffort)) return null;
  if (Object.hasOwn(value, "fast") && typeof value.fast !== "boolean") return null;
  if (Object.hasOwn(value, "millionContext") && typeof value.millionContext !== "boolean") return null;
  if (Object.hasOwn(value, "autoDisableGlobalRouting") && typeof value.autoDisableGlobalRouting !== "boolean") return null;
  if (Object.hasOwn(value, "autoDisableOnLowQuota") && typeof value.autoDisableOnLowQuota !== "boolean") return null;
  if (Object.hasOwn(value, "quotaRemainingThreshold") && !isTurboQuotaThreshold(value.quotaRemainingThreshold)) return null;
  if (Object.hasOwn(value, "accessMode") && !TURBO_ACCESS_MODES.includes(value.accessMode)) return null;
  if (Object.hasOwn(value, "deviceIds") && (!Array.isArray(value.deviceIds) || value.deviceIds.length > 32 || value.deviceIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)))) return null;
  const action = {};
  for (const key of allowed) if (Object.hasOwn(value, key)) action[key] = key === "deviceIds" ? [...new Set(value[key])] : value[key];
  return Object.freeze(action);
}

export function parseNativeTurboRequest(payload) {
  let value;
  try { value = JSON.parse(String(payload || "")); } catch { return null; }
  if (value && Object.hasOwn(value, "operation")) {
    if (!['save', 'sync'].includes(value.operation) ||
        typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value.requestId) ||
        Object.keys(value).some((key) => !['operation', 'requestId', 'change'].includes(key))) return null;
    const change = parseNativeTurboAction(JSON.stringify(value.change));
    return change ? { operation: value.operation, requestId: value.requestId, change } : null;
  }
  const change = parseNativeTurboAction(payload);
  return change ? { operation: 'update', requestId: null, change } : null;
}

export async function applyNativeTurboAction(payload, turboController) {
  const request = parseNativeTurboRequest(payload);
  if (!request || typeof turboController?.[request.operation] !== 'function') return null;
  return turboController[request.operation](request.change);
}

export async function respondToNativeTurboBinding(payload, connection, turboController) {
  const request = parseNativeTurboRequest(payload);
  if (!request) return null;
  let result;
  try {
    if (typeof turboController?.[request.operation] !== 'function') throw new Error('Turbo 设置服务不可用');
    result = await turboController[request.operation](request.change);
  } catch {
    result = { error: '未能完成本机保存或应用设置，请重试。设备同步尚未完成。' };
  }
  const response = { ...result, operation: request.operation, requestId: request.requestId };
  if (request.requestId) {
    const snapshot = turboController?.read?.() || null;
    await connection.evaluate(`(() => { const snapshot = ${JSON.stringify(snapshot)}; if (snapshot) window.__codexControlConsoleSetTurboPolicy?.(snapshot); return window.__codexControlConsoleTurboActionResult?.(${JSON.stringify(response)}) || null; })()`);
  }
  return response;
}

export function buildNativeTurboActionSource(bindingName) {
  return `
  const state = { turboActionPending: null, turboActionResult: null };
  clearTimeout(window.__codexControlConsoleTurboActionTimer);
  function turboSend(change, operation = 'sync') {
    if (pending || state.turboActionPending) return false;
    const bindingFn = window[${JSON.stringify(bindingName)}];
    if (typeof bindingFn !== 'function') {
      state.turboActionResult = { operation, error: 'Turbo 设置服务未连接，请稍后重试。' };
      renderTurboSettingsResult();
      return false;
    }
    const requestId = 'turbo-action-' + Date.now() + '-' + (++requestSequence);
    state.turboActionPending = { requestId, operation };
    state.turboActionResult = null;
    pending = true;
    window.__codexControlConsoleTurboActionTimer = setTimeout(() => {
      window.__codexControlConsoleTurboActionResult({ requestId, operation, error: '等待结果超时，尚未确认是否完成，请检查设备状态后重试。' });
    }, 90000);
    renderTurboSettingsResult();
    installButton();
    try { bindingFn(JSON.stringify({ requestId, operation, change })); }
    catch {
      window.__codexControlConsoleTurboActionResult({ requestId, operation, error: '未能提交设置，请重试。' });
      return false;
    }
    return true;
  }
  window.__codexControlConsoleTurboActionResult = (result) => {
    if (!state.turboActionPending || result?.requestId !== state.turboActionPending.requestId) return false;
    clearTimeout(window.__codexControlConsoleTurboActionTimer);
    state.turboActionPending = null;
    state.turboActionResult = result;
    pending = false;
    renderTurboSettingsResult();
    installButton();
    return true;
  };
`;
}
