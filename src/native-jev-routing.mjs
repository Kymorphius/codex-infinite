import { formatNativeJevEffort, formatNativeJevModelChange, formatNativeJevTurnChoice, normalizeNativeJevRoutingSnapshot, releaseNativeJevSend, selectNativeJevRoutingTurn } from "./native-jev-routing-contract.mjs";
import { findNativeJevModelChangeNotices, installNativeJevMutationRefresh, updateNativeJevPendingRetry } from "./native-jev-mutation-refresh.mjs";
import { handleNativeJevRoutingRequest, parseNativeJevRoutingRequest } from "./native-jev-routing-request.mjs";
import { buildNativeJevComposerControlSource } from "./native-jev-composer-controls.mjs";
import { buildNativeJevButtonRenderSource } from "./native-jev-button-render.mjs";
import { installNativeJevButtonActivation } from "./native-jev-button-activation.mjs";
import { buildNativeJevRoutingPanelSource } from "./native-jev-routing-panel.mjs";
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
  if (window.__codexControlConsoleJevRoutingVersion === '2026-09-25.hybrid-route1') return;
  const oldInstallTimer = window.__codexControlConsoleJevRoutingInstallTimer;
  if (oldInstallTimer) clearInterval(oldInstallTimer);
  window.__codexControlConsoleJevRoutingInstallTimer = null;
  window.__codexControlConsoleJevRoutingInputCleanup?.();
  window.__codexControlConsoleJevRoutingMutationCleanup?.();
  window.__codexControlConsoleRestoreJevNativeModelControl?.();
  document.querySelector('[data-codex-control-console-jev-routing-panel]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev-current]')?.remove();
  document.querySelector('[data-codex-control-console-native-jev-choice]')?.remove();
  document.querySelectorAll('[data-codex-control-console-jev-turn]').forEach((node) => node.remove());
  window.__codexControlConsoleJevRoutingVersion = '2026-09-25.hybrid-route1';
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
      const choice = { threadId, turnId, tier: pendingChoice.classification.tier, model: pendingChoice.classification.model, effort: pendingChoice.classification.effort, confidence: Number.isFinite(pendingChoice.classification.confidence) ? pendingChoice.classification.confidence : null, lowConfidence: pendingChoice.classification.lowConfidence === true, fallback: pendingChoice.classification.fallback === true, source: pendingChoice.classification.source === 'dimensions' ? 'dimensions' : pendingChoice.classification.source === 'jev' ? 'jev' : 'fallback', dimensionScore: Number.isFinite(pendingChoice.classification.dimensionScore) ? pendingChoice.classification.dimensionScore : null, dimensionConfidence: Number.isFinite(pendingChoice.classification.dimensionConfidence) ? pendingChoice.classification.dimensionConfidence : null, reason: String(pendingChoice.classification.reason || '').slice(0, 300), appliedAt: new Date().toISOString() };
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
      const confidence = Number.isFinite(choice.confidence) ? ' · 置信度 ' + choice.confidence.toFixed(2) : '';
      const badgeSignature = JSON.stringify([label, choice.reason || 'Jev 自动选择', confidence]);
      if (badge.getAttribute('data-codex-control-console-jev-render-signature') === badgeSignature) continue;
      badge.textContent = label;
      badge.title = (choice.reason || 'Jev 自动选择') + confidence;
      badge.setAttribute('aria-label', '本轮 ' + label);
      badge.style.cssText = 'align-self:flex-end;display:inline-flex;max-width:100%;height:22px;align-items:center;padding:0 8px;border:1px solid rgba(106,190,138,.34);border-radius:999px;background:rgba(75,166,110,.10);color:#62bd84;font:600 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.86;';
      badge.setAttribute('data-codex-control-console-jev-render-signature', badgeSignature);
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

${buildNativeJevButtonRenderSource()}
${buildNativeJevComposerControlSource()}
${buildNativeJevRoutingPanelSource()}
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
    if (host && host.classList?.contains('ms-auto') && !host.parentElement?.hasAttribute('data-codex-control-console-interactive-header')) host.parentElement?.setAttribute('data-codex-control-console-interactive-header', '');
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
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); if (!togglePending) openRoutingPanel(button); });
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
    const anchor = context || permission;
    if (anchor.nextElementSibling !== current) anchor.after(current);
    if (choice && current.nextElementSibling !== choice) current.after(choice);
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
