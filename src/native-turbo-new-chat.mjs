export function buildNativeTurboNewChatSource() {
  return `
  let turboNewChatBusy = false;
  let turboNewChatPromise = null;
  let turboNewChatReadySignature = '';
  let turboNewChatReplayPending = false;
  const turboNewChatWait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function turboNewChatTrigger() {
    const mounted = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
    return /^[0-9a-f-]{36}$/i.test(mounted) ? null : document.querySelector('button[data-composer-navigation-target="reasoning"]');
  }

  function normalizeTurboNewChatModelLabel(value) {
    return String(value || '').trim().toLowerCase().replace(/^gpt[-\\s]?/, '').replace(/-/g, ' ').replace(/\\s+/g, ' ');
  }

  function turboNewChatModel(trigger) {
    const labels = Array.from(trigger?.querySelectorAll?.('span') || []).map((node) => String(node.textContent || '').trim()).filter(Boolean);
    return Array.from(policy.efforts.keys()).find((model) => labels.some((label) => normalizeTurboNewChatModelLabel(label) === normalizeTurboNewChatModelLabel(turboLabel(model)))) || null;
  }

  function turboNewChatTarget() {
    const trigger = turboNewChatTrigger();
    if (!trigger || !policy.enabled || !policy.active || (typeof turboManualBlocks === 'function' && turboManualBlocks(null))) return null;
    const model = policy.model || turboNewChatModel(trigger);
    const effort = policy.reasoningEffort === 'preserve' ? null : policy.reasoningEffort === 'maximum' ? policy.efforts.get(model) || null : policy.reasoningEffort;
    return { trigger, model, effort, revision: typeof turboManualRevision === 'function' ? turboManualRevision() : 0, signature: [model || 'preserve', effort || 'preserve', policy.fast ? 'fast' : 'native'].join(':') };
  }

  function assertTurboNewChatCurrent(target) {
    const current = turboNewChatTarget();
    if (!current || current.trigger !== target.trigger || current.signature !== target.signature || current.revision !== target.revision) { const error = new Error('Turbo 预设已被会话选择替代'); error.superseded = true; throw error; }
  }

  async function turboNewChatWaitFor(read, attempts = 20) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const value = read();
      if (value) return value;
      await turboNewChatWait(25);
    }
    return null;
  }

  async function turboNewChatOpenMenu(target) {
    assertTurboNewChatCurrent(target);
    const open = document.querySelector('[role="menu"][data-state="open"] [data-reasoning-slider]');
    if (open) return open;
    target.trigger.click();
    return turboNewChatWaitFor(() => document.querySelector('[role="menu"][data-state="open"] [data-reasoning-slider]'));
  }

  async function turboNewChatSelectModel(target) {
    if (!target.model || turboNewChatModel(target.trigger) === target.model) return;
    await turboNewChatOpenMenu(target);
    const toggle = await turboNewChatWaitFor(() => document.querySelector('[role="menuitem"][data-model-picker-view-toggle]'));
    assertTurboNewChatCurrent(target);
    toggle?.click();
    const option = await turboNewChatWaitFor(() => Array.from(document.querySelectorAll('[role="menuitemradio"]')).find((node) => normalizeTurboNewChatModelLabel(node.textContent) === normalizeTurboNewChatModelLabel(turboLabel(target.model))));
    assertTurboNewChatCurrent(target);
    if (!option) throw new Error('Turbo 找不到新对话模型选项');
    option.click();
    if (!await turboNewChatWaitFor(() => turboNewChatModel(target.trigger) === target.model)) throw new Error('Turbo 新对话模型没有生效');
  }

  async function turboNewChatSelectEffort(target) {
    if (!target.effort) return;
    const effortOrder = policy.modelOptions.find((item) => item.id === target.model)?.efforts || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      assertTurboNewChatCurrent(target);
      const current = String(target.trigger.getAttribute('data-selected-reasoning-effort') || '');
      if (current === target.effort) return;
      const control = await turboNewChatOpenMenu(target);
      assertTurboNewChatCurrent(target);
      if (!control) break;
      const currentIndex = effortOrder.indexOf(current);
      const targetIndex = effortOrder.indexOf(target.effort);
      const key = currentIndex >= 0 && targetIndex >= 0 && currentIndex > targetIndex ? 'ArrowLeft' : 'ArrowRight';
      control.focus?.();
      control.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, composed: true }));
      await turboNewChatWait(70);
    }
    throw new Error('Turbo 新对话推理强度没有生效');
  }

  async function turboNewChatEnableFast(target) {
    if (!policy.fast) return;
    await turboNewChatOpenMenu(target);
    const fast = await turboNewChatWaitFor(() => document.querySelector('[role="menuitemcheckbox"][aria-label*="快速"], [role="menuitemcheckbox"][aria-label*="Fast"]'));
    assertTurboNewChatCurrent(target);
    if (!fast) throw new Error('Turbo 找不到新对话 Fast 开关');
    if (fast.getAttribute('aria-checked') !== 'true') { fast.click(); await turboNewChatWait(70); }
    assertTurboNewChatCurrent(target);
    if (fast.getAttribute('aria-checked') !== 'true') throw new Error('Turbo 新对话 Fast 没有生效');
    document.body.click();
  }

  async function syncTurboNewChatPreset() {
    const target = turboNewChatTarget();
    if (!target) { turboNewChatReadySignature = ''; return false; }
    if (turboNewChatReadySignature === target.signature) return true;
    if (turboNewChatBusy) return turboNewChatPromise;
    turboNewChatBusy = true;
    turboNewChatPromise = (async () => {
      try {
        await turboNewChatSelectModel(target);
        await turboNewChatSelectEffort(target);
        await turboNewChatEnableFast(target);
        assertTurboNewChatCurrent(target);
        turboNewChatReadySignature = target.signature;
        window.__codexControlConsoleLastTurboEnforcement = { ok: true, mode: 'new-chat-preset', model: target.model, reasoningEffort: target.effort, serviceTier: policy.fast ? 'priority' : 'default', appliedAt: new Date().toISOString() };
        decorateReasoningControl();
        return true;
      } catch (error) {
        turboNewChatReadySignature = '';
        if (!error.superseded) window.__codexControlConsoleLastTurboEnforcement = { ok: false, mode: 'new-chat-preset', message: String(error?.message || error).slice(0, 240), appliedAt: new Date().toISOString() };
        return false;
      } finally { turboNewChatBusy = false; turboNewChatPromise = null; }
    })();
    return turboNewChatPromise;
  }

  function turboNewChatIsReady() {
    const target = turboNewChatTarget();
    return Boolean(target && turboNewChatReadySignature === target.signature);
  }

  function replayTurboNewChatSubmission() {
    if (turboNewChatReplayPending || (!turboNewChatIsReady() && !(typeof turboManualHas === 'function' && turboManualHas(null)))) return;
    const send = Array.from(document.querySelectorAll('button')).find((button) => /^(发送|Send)$/i.test(String(button.getAttribute('aria-label') || button.textContent || '').trim()) && !button.disabled);
    if (!send) return;
    turboNewChatReplayPending = true;
    queueMicrotask(() => { try { send.click(); } finally { turboNewChatReplayPending = false; } });
  }

  function blockUnpreparedTurboNewChat(event) {
    if (turboNewChatReplayPending || !turboNewChatTarget() || turboNewChatIsReady()) return;
    const button = event.target?.closest?.('button');
    const clickedSend = event.type === 'click' && button && /^(发送|Send)$/i.test(String(button.getAttribute('aria-label') || button.textContent || '').trim());
    const pressedEnter = event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.target?.closest?.('[contenteditable="true"],textarea');
    if (!clickedSend && !pressedEnter) return;
    const trigger = turboNewChatTrigger();
    event.preventDefault(); event.stopImmediatePropagation();
    void syncTurboNewChatPreset().then(async (ready) => {
      if (!ready && typeof turboManualBlocks === 'function' && turboManualBlocks(null)) await turboNewChatWaitFor(() => typeof turboManualHas === 'function' && turboManualHas(null), 200);
      if (turboNewChatTrigger() !== trigger) return;
      if (ready || (typeof turboManualHas === 'function' && turboManualHas(null))) {
        if (event.isTrusted && typeof turboManualChoice !== 'undefined') turboManualChoice?.submitDraft();
        replayTurboNewChatSubmission();
      }
    });
  }

  document.addEventListener?.('click', blockUnpreparedTurboNewChat, true);
  document.addEventListener?.('keydown', blockUnpreparedTurboNewChat, true);
  const turboNewChatObserver = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (turboNewChatTrigger() && !turboNewChatIsReady()) void syncTurboNewChatPreset(); }) : null;
  if (document.body) turboNewChatObserver?.observe(document.body, { childList: true, subtree: true });
  window.__codexControlConsoleTurboNewChatCleanup = () => { turboNewChatObserver?.disconnect(); document.removeEventListener?.('click', blockUnpreparedTurboNewChat, true); document.removeEventListener?.('keydown', blockUnpreparedTurboNewChat, true); };
`;
}
