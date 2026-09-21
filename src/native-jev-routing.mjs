import { formatNativeJevEffort, formatNativeJevModelChange, formatNativeJevTurnChoice, normalizeNativeJevRoutingSnapshot, releaseNativeJevSend, selectNativeJevRoutingTurn } from "./native-jev-routing-contract.mjs";
import { findNativeJevModelChangeNotices, installNativeJevMutationRefresh, updateNativeJevPendingRetry } from "./native-jev-mutation-refresh.mjs";
import { handleNativeJevRoutingRequest, parseNativeJevRoutingRequest } from "./native-jev-routing-request.mjs";
import { buildNativeJevComposerControlSource } from "./native-jev-composer-controls.mjs";
import { installNativeJevButtonActivation } from "./native-jev-button-activation.mjs";
export { formatNativeJevEffort, formatNativeJevModelChange, formatNativeJevTurnChoice, normalizeNativeJevRoutingSnapshot, releaseNativeJevSend, selectNativeJevRoutingTurn } from "./native-jev-routing-contract.mjs";
export { handleNativeJevRoutingRequest, parseNativeJevRoutingRequest } from "./native-jev-routing-request.mjs";

export const NATIVE_JEV_ROUTING_BINDING = "__codexControlConsoleJevRouting";

export function buildNativeJevRoutingResponseScript(response) {
  return `window.__codexControlConsoleResolveJevRouting?.(${JSON.stringify(response ?? null)})`;
}

export async function respondToNativeJevRoutingBinding(payload, connection, service) {
  const response = await handleNativeJevRoutingRequest(payload, service);
  if (response) await connection.evaluate(buildNativeJevRoutingResponseScript(response));
  return response;
}

export function buildNativeJevRoutingSnapshotScript(snapshot) {
  return `window.__codexControlConsoleSetJevRouting?.(${JSON.stringify(normalizeNativeJevRoutingSnapshot(snapshot))}) || null`;
}

export function buildNativeJevRoutingInjectionScript() {
  const binding = JSON.stringify(NATIVE_JEV_ROUTING_BINDING);
  return `(() => {
  if (window.__codexControlConsoleJevRoutingVersion === '2026-09-21.16') return;
  const oldInstallTimer = window.__codexControlConsoleJevRoutingInstallTimer;
  if (oldInstallTimer) clearInterval(oldInstallTimer);
  window.__codexControlConsoleJevRoutingInstallTimer = null;
  window.__codexControlConsoleJevRoutingInputCleanup?.();
  window.__codexControlConsoleJevRoutingMutationCleanup?.();
  window.__codexControlConsoleRestoreJevNativeModelControl?.();
  document.querySelector('[data-codex-control-console-native-jev]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev-current]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev-choice]')?.remove();
  document.querySelectorAll('[data-codex-control-console-jev-turn]').forEach((node) => node.remove());
  window.__codexControlConsoleJevRoutingVersion = '2026-09-21.16';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const HISTORY_KEY = 'codex-control-console.jev-turn-choices.v1';
  const formatNativeJevEffort=${formatNativeJevEffort.toString()};
  const formatModelChange=${formatNativeJevModelChange.toString()};
  const formatTurnChoice = ${formatNativeJevTurnChoice.toString()};
  const selectTurn = ${selectNativeJevRoutingTurn.toString()};
  const releaseSend = ${releaseNativeJevSend.toString()};
  const genericModelChangeNotices = ${findNativeJevModelChangeNotices.toString()};
  const installMutationRefresh = ${installNativeJevMutationRefresh.toString()};
  const updatePendingTurnRetry = ${updateNativeJevPendingRetry.toString()};
  const installButtonActivation = ${installNativeJevButtonActivation.toString()};
  let policy = { enabled: false, available: false, transportMode: 'router', fallbackTier: 'everyday', mappings: {}, threadOverrides: {}, receipts: [] };
  let sequence = 0;
  let togglePending = false;
  let submissionPending = false;
  let bypassNextComposerClick = false;
  let bypassNativeTurn = null;
  let pendingTurnChoices = [];
  let pendingTurnRetry = null;
  const pending = new Map();
  let turnChoices = [];
  try { const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); if (Array.isArray(saved)) turnChoices = saved.slice(-512); } catch {}

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

  function visibleTurns() {
    return Array.from(document.querySelectorAll('[data-content-search-turn-key]')).flatMap((node) => {
      const id = String(node.getAttribute('data-content-search-turn-key') || '').toLowerCase();
      if (!UUID.test(id)) return [];
      return [{ id, node, userText: node.querySelector('[data-user-message-bubble]')?.innerText?.trim() || '' }];
    });
  }

  function persistTurnChoices() {
    turnChoices = turnChoices.filter((item) => UUID.test(String(item?.threadId || '')) && UUID.test(String(item?.turnId || '')) && formatTurnChoice(item)).slice(-512);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(turnChoices)); } catch {}
  }

  function queueTurnChoice(threadId, prompt, beforeIds, classification) {
    if (!UUID.test(threadId) || !formatTurnChoice(classification)) return;
    pendingTurnChoices.push({ threadId, prompt: String(prompt || '').trim(), beforeIds: Array.isArray(beforeIds) ? beforeIds : [], classification, queuedAt: Date.now() });
    pendingTurnChoices = pendingTurnChoices.slice(-32);
    reconcileTurnChoices();
  }

  function reconcileTurnChoices() {
    const threadId = currentThreadId(), candidates = visibleTurns(), remaining = [];
    for (const pendingChoice of pendingTurnChoices) {
      if (Date.now() - pendingChoice.queuedAt > 300000) continue;
      if (pendingChoice.threadId !== threadId) { remaining.push(pendingChoice); continue; }
      const used = turnChoices.filter((item) => item.threadId === threadId).map((item) => item.turnId);
      const turnId = selectTurn(candidates, pendingChoice.prompt, pendingChoice.beforeIds, used, Date.now() - pendingChoice.queuedAt >= 800);
      if (!turnId) { remaining.push(pendingChoice); continue; }
      const choice = { threadId, turnId, tier: pendingChoice.classification.tier, model: pendingChoice.classification.model, effort: pendingChoice.classification.effort, confidence: Number.isFinite(pendingChoice.classification.confidence) ? pendingChoice.classification.confidence : null, lowConfidence: pendingChoice.classification.lowConfidence === true, fallback: pendingChoice.classification.fallback === true, reason: String(pendingChoice.classification.reason || '').slice(0, 300), appliedAt: new Date().toISOString() };
      turnChoices = turnChoices.filter((item) => item.threadId !== threadId || item.turnId !== turnId); turnChoices.push(choice); persistTurnChoices();
    }
    pendingTurnChoices = remaining;
    pendingTurnRetry = updatePendingTurnRetry(remaining, pendingTurnRetry, () => { pendingTurnRetry = null; installButtons(); });
  }

  function decorateTurnChoices() {
    const threadId = currentThreadId();
    for (const turn of visibleTurns()) {
      const choice = turnChoices.find((item) => item.threadId === threadId && item.turnId === turn.id);
      let badge = turn.node.querySelector('[data-codex-control-console-jev-turn]');
      if (!choice) { badge?.remove(); continue; }
      const notice = genericModelChangeNotices(turn.node).at(-1);
      const textNodes = Array.from(notice?.childNodes || []).filter((child) => child.nodeType === 3);
      const modelChange = formatModelChange(choice);
      if (notice && textNodes.length && textNodes.map((child) => child.nodeValue || '').join('').trim() !== modelChange) {
        textNodes[0].nodeValue = modelChange;
        for (const text of textNodes.slice(1)) text.nodeValue = '';
        notice.setAttribute('data-codex-control-console-jev-model-change', '');
      }
      const label = formatTurnChoice(choice), bubble = turn.node.querySelector('[data-user-message-bubble]'), host = bubble?.parentElement;
      if (!label || !host) { badge?.remove(); continue; }
      if (!badge) { badge = document.createElement('div'); badge.setAttribute('data-codex-control-console-jev-turn', ''); bubble.after(badge); }
      badge.textContent = label;
      const confidence = Number.isFinite(choice.confidence) ? ' · 置信度 ' + choice.confidence.toFixed(2) : '';
      badge.title = (choice.reason || 'Jev 自动选择') + confidence;
      badge.setAttribute('aria-label', '本轮 ' + label);
      badge.style.cssText = 'align-self:flex-end;display:inline-flex;max-width:100%;height:22px;align-items:center;padding:0 8px;border:1px solid rgba(106,190,138,.34);border-radius:999px;background:rgba(75,166,110,.10);color:#62bd84;font:600 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.86;';
    }
  }

  function nativeSendButton() {
    return document.querySelector('button[aria-label="发送"],button[aria-label="Send"]');
  }

  async function routeComposerSubmission() {
    const threadId = currentThreadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    if (submissionPending || !threadId || !editor) return;
    const prompt = String(editor.innerText || editor.textContent || '').trim();
    const beforeIds = visibleTurns().map((item) => item.id);
    submissionPending = true; installButtons();
    try {
      const classification = prompt ? (await request('classify', { prompt }, 22000)).classification : fallbackClassification('当前轮次没有文本，已使用兜底档位');
      if (!classification) throw new Error('没有可用的 Jev 路由结果');
      const apply = window.__codexControlConsoleApplyThreadSettings;
      if (typeof apply !== 'function') throw new Error('原生会话设置桥接不可用');
      await apply(threadId, { model: classification.model, reasoningEffort: classification.effort });
      window.__codexControlConsoleLastJevRouting = { ok: true, threadId, ...classification, appliedAt: new Date().toISOString() };
      queueTurnChoice(threadId, prompt, beforeIds, classification);
      if (window.electronBridge?.sendMessageFromView?.__codexControlTurboWrapped) bypassNativeTurn = { threadId, expiresAt: Date.now() + 30000 };
    } catch (error) {
      window.__codexControlConsoleLastJevRouting = { ok: false, threadId, message: String(error?.message || error), appliedAt: new Date().toISOString() };
    } finally {
      submissionPending = false; installButtons();
      const sent = await releaseSend(nativeSendButton, (send) => { bypassNextComposerClick = true; send.click(); if (bypassNextComposerClick) queueMicrotask(() => { bypassNextComposerClick = false; }); }, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      if (!sent) window.__codexControlConsoleLastJevRouting = { ...(window.__codexControlConsoleLastJevRouting || {}), ok: false, message: 'Jev 已完成选择，但原生发送按钮在 5 秒内没有恢复可用' };
    }
  }

  function interceptComposerClick(event) {
    const send = event.target?.closest?.('button[aria-label="发送"],button[aria-label="Send"]');
    if (!send) return;
    if (bypassNextComposerClick) { bypassNextComposerClick = false; return; }
    const threadId = currentThreadId();
    if (!effectiveEnabled(threadId)) return;
    event.preventDefault(); event.stopImmediatePropagation(); void routeComposerSubmission();
  }

  function interceptComposerKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing || !event.target?.closest?.('[data-codex-composer="true"][contenteditable="true"]')) return;
    const send = nativeSendButton(), threadId = currentThreadId();
    if (!send || send.disabled || !effectiveEnabled(threadId)) return;
    event.preventDefault(); event.stopImmediatePropagation(); void routeComposerSubmission();
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
    button.textContent = 'Jev';
    button.title = togglePending ? '正在统一所有会话的自动分流设置…' : active ? '统一开启：所有未单独设置的会话自动分流；点击关闭并清除会话覆盖' : '统一关闭：所有未单独设置的会话不自动分流；点击开启并清除会话覆盖';
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;align-items:center;height:24px;padding:0 8px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.24)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '.88') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
  }

  function renderCurrentButton(button) {
    const threadId = currentThreadId();
    const active = effectiveEnabled(threadId);
    const overridden = Boolean(threadId && Object.prototype.hasOwnProperty.call(policy.threadOverrides, threadId));
    button.dataset.enabled = String(active); button.dataset.threadId = threadId || ''; button.dataset.override = String(overridden);
    button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', threadId ? (active ? '当前会话 Jev 自动分流已开启' : '当前会话 Jev 自动分流已关闭') : (active ? '新建聊天的全局 Jev 自动分流已开启' : '新建聊天的全局 Jev 自动分流已关闭')); button.disabled = togglePending || submissionPending;
    button.textContent = submissionPending ? 'Jev 判断中…' : policy.transportMode === 'native' ? 'Jev 原生' : 'Jev 路由';
    button.title = !threadId ? (active ? '新建聊天继承全局 Jev 路由；点击关闭全局路由' : '新建聊天继承全局设置；点击开启全局 Jev 路由') : submissionPending ? 'Jev 正在为这一轮选择模型与推理强度' : togglePending ? '正在保存当前会话设置…' : (overridden ? '当前会话单独' : '继承全局') + (active ? '开启；点击只关闭当前会话' : '关闭；点击只开启当前会话');
    button.style.cssText = 'display:inline-flex;position:relative;z-index:1;flex:0 0 82px;justify-content:center;align-items:center;height:28px;padding:0 9px;border:1px solid ' + (active ? 'rgba(106,190,138,.52)' : 'rgba(128,128,128,.25)') + ';border-radius:999px;background:' + (active ? 'rgba(75,166,110,.15)' : 'transparent') + ';color:' + (active ? '#62bd84' : 'currentColor') + ';font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:' + (togglePending ? 'wait' : 'pointer') + ';opacity:' + (togglePending ? '.58' : '1') + ';pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
  }
${buildNativeJevComposerControlSource()}
  function applySnapshot(snapshot) {
    const value = snapshot || {};
    const config = value.config || value;
    policy = { enabled: config?.enabled !== false, available: value?.available === true || policy.available, transportMode: config?.transportMode === 'native' ? 'native' : 'router', fallbackTier: String(config?.fallbackTier || 'everyday'), mappings: config?.mappings && typeof config.mappings === 'object' ? config.mappings : {}, threadOverrides: value?.threadOverrides && typeof value.threadOverrides === 'object' ? value.threadOverrides : {}, receipts: Array.isArray(value?.receipts) ? value.receipts : [] };
    for (const receipt of policy.receipts) {
      if (!UUID.test(String(receipt?.threadId || '')) || !UUID.test(String(receipt?.turnId || '')) || !formatTurnChoice(receipt)) continue;
      const choice = { ...receipt, appliedAt: receipt.routedAt || new Date().toISOString() };
      turnChoices = turnChoices.filter((item) => item.threadId !== choice.threadId || item.turnId !== choice.turnId);
      turnChoices.push(choice);
    }
    persistTurnChoices();
  }
  function installButtons() {
    const host = buttonHost();
    if (host && host.classList?.contains('ms-auto')) host.parentElement?.setAttribute('data-codex-control-console-interactive-header', '');
    let button = document.querySelector('[data-codex-control-console-native-jev]');
    if (host && !button) {
      button = document.createElement('button'); button.type = 'button'; button.setAttribute('data-codex-control-console-native-jev', '');
      installButtonActivation(button, async () => {
        if (togglePending) return;
        togglePending = true; renderGlobalButton(button); const current = document.querySelector('[data-codex-control-console-native-jev-current]'); if (current) renderCurrentButton(current);
        try {
          const response = await request('set-enabled', { enabled: !policy.enabled }, 8000);
          applySnapshot(response.snapshot);
        } catch (error) { button.title = String(error?.message || error); }
        finally { togglePending = false; renderGlobalButton(button); if (current) renderCurrentButton(current); }
      });
    }
    if (host && button) { renderGlobalButton(button); if (button.parentElement !== host) host.insertBefore(button, host.firstChild); }

    const threadId = currentThreadId(); const permission = document.querySelector('[data-composer-navigation-target="permissions"]'); const composerHost = permission?.parentElement;
    let current = document.querySelector('[data-codex-control-console-native-jev-current]'), choice = document.querySelector('[data-codex-control-console-native-jev-choice]');
    reconcileTurnChoices(); decorateTurnChoices();
    const active = effectiveEnabled(threadId); renderNativeModelControl(active, threadId);
    if (!composerHost) { current?.remove(); choice?.remove(); return; }
    if (!current) {
      current = document.createElement('button'); current.type = 'button'; current.setAttribute('data-codex-control-console-native-jev-current', '');
      installButtonActivation(current, async () => {
        const selectedThreadId = currentThreadId(); if (togglePending) return;
        togglePending = true; renderCurrentButton(current); if (button) renderGlobalButton(button);
        try { const response = selectedThreadId ? await request('set-thread-enabled', { threadId: selectedThreadId, enabled: !effectiveEnabled(selectedThreadId) }, 8000) : await request('set-enabled', { enabled: !policy.enabled }, 8000); applySnapshot(response.snapshot); }
        catch (error) { current.title = String(error?.message || error); }
        finally { togglePending = false; renderCurrentButton(current); if (button) renderGlobalButton(button); }
      });
    }
    renderCurrentButton(current);
    choice = renderCurrentChoice(choice, threadId, active);
    const context = composerHost.querySelector('[data-codex-control-console-context-toggle]');
    if (context) context.after(current); else permission.after(current);
    if (choice) current.after(choice);
  }
  // Sending remains entirely native. Jev routing now happens after the
  // authenticated request reaches Codex Router, and exact turn receipts flow
  // back through snapshots for display only.
  window.__codexControlConsoleRouteNativeTurn = async (message) => message;

  window.__codexControlConsoleSetJevRouting = (value) => {
    applySnapshot({ config: value, available: value?.available, threadOverrides: value?.threadOverrides, receipts: value?.receipts });
    togglePending = false; installButtons();
    return { enabled: policy.enabled, available: policy.available, fallbackTier: policy.fallbackTier };
  };
  installButtons();
  window.__codexControlConsoleJevRoutingMutationCleanup = installMutationRefresh({ install: installButtons, findModelChangeNotices: genericModelChangeNotices, hostWindow: window });
  window.__codexControlConsoleJevRoutingInputCleanup = () => {};
  window.__codexControlConsoleJevRoutingDiagnostics = { refreshMode: 'shared-mutation-events' };
  window.addEventListener('beforeunload', () => { pendingTurnRetry && clearTimeout(pendingTurnRetry); window.__codexControlConsoleJevRoutingMutationCleanup?.(); window.__codexControlConsoleJevRoutingInputCleanup?.(); for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('页面已关闭')); } pending.clear(); }, { once: true });
})()`;
}
