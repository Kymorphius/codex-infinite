export function buildNativeTurboEnforcementSource() {
  return `
  const turboLeaseStorageKey = 'codex-control-console.turbo-setting-leases.v1';
  const turboLeases = new Map();
  const turboAppliedSignatures = new Map();
  let turboEnforcementBusy = false;
  try {
    const stored = JSON.parse(localStorage.getItem(turboLeaseStorageKey) || '[]');
    for (const lease of Array.isArray(stored) ? stored.slice(-64) : []) {
      if (/^[0-9a-f-]{36}$/.test(String(lease?.threadId || '')) && typeof lease?.model === 'string' && typeof lease?.reasoningEffort === 'string') turboLeases.set(lease.threadId, lease);
    }
  } catch {}

  function selectedTurboThreadId() {
    const mounted = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mounted)) return mounted.toLowerCase();
    const selected = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    return selected.startsWith('local:') && /^[0-9a-f-]{36}$/i.test(selected.slice(6)) ? selected.slice(6).toLowerCase() : null;
  }

  function persistTurboLeases() {
    try { localStorage.setItem(turboLeaseStorageKey, JSON.stringify(Array.from(turboLeases.values()).slice(-64))); } catch {}
  }

  function turboPolicySignature(threadId) {
    return [threadId, policy.model || '', policy.reasoningEffort, policy.fast, policy.millionContext, policy.accessMode].join(':');
  }

  function turboBridgeIsWrapped() {
    return Boolean(window.electronBridge?.sendMessageFromView?.__codexControlTurboWrapped);
  }

  async function readTurboThreadSettings(threadId) {
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') throw new Error('Turbo 原生会话桥接尚未就绪');
    const result = await resumeContext(bridge.bind(window.electronBridge), threadId, null);
    const model = String(result?.model || result?.thread?.model || '');
    const reasoningEffort = String(result?.reasoningEffort || result?.thread?.reasoningEffort || '');
    if (!model || !reasoningEffort) throw new Error('Turbo 无法读取会话真实模型');
    return {
      threadId, model, reasoningEffort,
      serviceTier: ['default', 'priority', 'ultrafast'].includes(result?.serviceTier) ? result.serviceTier : 'default',
      permissionProfile: String(result?.activePermissionProfile?.id || ''),
      contextWindow: Number(window.__codexControlConsoleGetContextWindow?.(threadId)) || null
    };
  }

  function turboChanges(lease) {
    const model = policy.model || lease.model;
    const maximum = policy.efforts.get(model);
    const reasoningEffort = policy.reasoningEffort === 'preserve' ? lease.reasoningEffort : policy.reasoningEffort === 'maximum' ? maximum || lease.reasoningEffort : policy.reasoningEffort;
    const changes = { model, reasoningEffort, serviceTier: policy.fast ? 'priority' : lease.serviceTier };
    const permissions = { 'read-only': ':read-only', workspace: ':workspace', 'full-access': ':danger-full-access' };
    if (permissions[policy.accessMode]) changes.permissionProfile = permissions[policy.accessMode];
    if (policy.millionContext) changes.contextWindow = 1000000;
    return changes;
  }

  function restoreChanges(lease) {
    const changes = { model: lease.model, reasoningEffort: lease.reasoningEffort, serviceTier: lease.serviceTier, contextWindow: lease.contextWindow };
    if ([':read-only', ':workspace', ':danger-full-access'].includes(lease.permissionProfile)) changes.permissionProfile = lease.permissionProfile;
    return changes;
  }

  async function applyTurboLease(threadId) {
    const apply = window.__codexControlConsoleApplyThreadSettings;
    if (typeof apply !== 'function') throw new Error('Turbo 原生设置服务尚未就绪');
    let lease = turboLeases.get(threadId);
    if (!lease) {
      lease = await readTurboThreadSettings(threadId);
      turboLeases.set(threadId, lease);
      persistTurboLeases();
    }
    const changes = turboChanges(lease);
    await apply(threadId, changes);
    const verified = await readTurboThreadSettings(threadId);
    if (verified.model !== changes.model || verified.reasoningEffort !== changes.reasoningEffort || verified.serviceTier !== changes.serviceTier) throw new Error('Turbo 设置未通过原生回读');
    turboAppliedSignatures.set(threadId, turboPolicySignature(threadId));
    window.__codexControlConsoleLastTurboEnforcement = { ok: true, mode: 'native-settings-lease', threadId, model: verified.model, reasoningEffort: verified.reasoningEffort, serviceTier: verified.serviceTier, contextWindow: changes.contextWindow || lease.contextWindow, appliedAt: new Date().toISOString() };
  }

  async function restoreTurboLeases() {
    const apply = window.__codexControlConsoleApplyThreadSettings;
    if (typeof apply !== 'function') throw new Error('Turbo 原生设置服务尚未就绪');
    for (const [threadId, lease] of Array.from(turboLeases)) {
      await apply(threadId, restoreChanges(lease));
      turboLeases.delete(threadId);
      turboAppliedSignatures.delete(threadId);
      persistTurboLeases();
    }
  }

  function turboIsEnforcedForCurrentThread() {
    if (turboBridgeIsWrapped()) return true;
    const threadId = selectedTurboThreadId();
    return Boolean(threadId && turboAppliedSignatures.get(threadId) === turboPolicySignature(threadId));
  }

  async function syncTurboEnforcement() {
    if (turboBridgeIsWrapped() || turboEnforcementBusy) return;
    const threadId = selectedTurboThreadId();
    if (policy.enabled && policy.active && threadId && turboAppliedSignatures.get(threadId) === turboPolicySignature(threadId)) return;
    if (!policy.enabled || !policy.active) {
      if (!turboLeases.size) return;
    } else if (!threadId) return;
    turboEnforcementBusy = true;
    try {
      if (policy.enabled && policy.active) await applyTurboLease(threadId);
      else await restoreTurboLeases();
    } catch (error) {
      window.__codexControlConsoleLastTurboEnforcement = { ok: false, mode: 'native-settings-lease', threadId, message: String(error?.message || error).slice(0, 240), appliedAt: new Date().toISOString() };
    } finally {
      turboEnforcementBusy = false;
      const button = document.querySelector('[data-codex-control-console-native-turbo]');
      if (button) renderButton(button);
      decorateReasoningControl();
    }
  }
`;
}
