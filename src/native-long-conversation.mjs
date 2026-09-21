export const LONG_CONVERSATION_EAGER_TURNS = 12;

export function longConversationColdTurnIndexes(turnCount, eagerTurns = LONG_CONVERSATION_EAGER_TURNS) {
  const count = Math.max(0, Math.floor(Number(turnCount) || 0));
  const eager = Math.max(1, Math.floor(Number(eagerTurns) || LONG_CONVERSATION_EAGER_TURNS));
  return Array.from({ length: Math.max(0, count - eager) }, (_, index) => index);
}

export function installNativeLongConversation(eagerTurns = 12) {
  const VERSION = '2026-09-21.1';
  const ROOT_SELECTOR = '[data-thread-user-message-navigation-content]';
  const TURN_SELECTOR = '[data-turn-key]';
  const COLD_ATTRIBUTE = 'data-ccc-long-conversation-cold-turn';
  const STYLE_ID = 'ccc-long-conversation-style';
  const previous = window.__codexControlConsoleLongConversation;
  if (previous?.version === VERSION) return previous.snapshot();
  previous?.destroy?.();

  const eager = Math.max(1, Math.floor(Number(eagerTurns) || 12));
  let timer = null;
  let idleHandle = null;
  let root = null;
  let turnCount = 0;
  let coldCount = 0;
  let scans = 0;

  const style = document.getElementById(STYLE_ID) || document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${COLD_ATTRIBUTE}]{content-visibility:auto;contain-intrinsic-size:auto 560px;}`;
  if (!style.isConnected) (document.head || document.documentElement).append(style);

  function clearScheduled() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (idleHandle != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleHandle);
    idleHandle = null;
  }

  function reconcile() {
    timer = null;
    idleHandle = null;
    const nextRoot = document.querySelector(ROOT_SELECTOR);
    if (root && root !== nextRoot) root.querySelectorAll(`[${COLD_ATTRIBUTE}]`).forEach((node) => node.removeAttribute(COLD_ATTRIBUTE));
    root = nextRoot;
    if (!root) { turnCount = 0; coldCount = 0; return; }
    const turns = Array.from(root.querySelectorAll(TURN_SELECTOR));
    const boundary = Math.max(0, turns.length - eager);
    turns.forEach((turn, index) => {
      if (index < boundary) {
        if (!turn.hasAttribute(COLD_ATTRIBUTE)) turn.setAttribute(COLD_ATTRIBUTE, '');
      } else if (turn.hasAttribute(COLD_ATTRIBUTE)) turn.removeAttribute(COLD_ATTRIBUTE);
    });
    turnCount = turns.length;
    coldCount = boundary;
    scans += 1;
  }

  function schedule() {
    if (timer || idleHandle != null) return;
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(reconcile, { timeout: 300 });
      return;
    }
    timer = setTimeout(reconcile, 120);
  }

  function relevantNode(node) {
    if (node?.nodeType !== 1) return false;
    return node.matches?.(`${ROOT_SELECTOR},${TURN_SELECTOR}`) || Boolean(node.querySelector?.(`${ROOT_SELECTOR},${TURN_SELECTOR}`));
  }

  function relevantMutation(record) {
    if (record.type === 'attributes') return record.target?.matches?.(TURN_SELECTOR) === true;
    return [...record.addedNodes, ...record.removedNodes].some(relevantNode);
  }

  const observer = new MutationObserver((records) => {
    if (records.some(relevantMutation)) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-turn-key'] });

  const controller = {
    version: VERSION,
    refresh: schedule,
    snapshot: () => ({ version: VERSION, eagerTurns: eager, turnCount, coldCount, scans }),
    destroy() {
      clearScheduled();
      observer.disconnect();
      document.querySelectorAll(`[${COLD_ATTRIBUTE}]`).forEach((node) => node.removeAttribute(COLD_ATTRIBUTE));
      style.remove();
      if (window.__codexControlConsoleLongConversation === controller) delete window.__codexControlConsoleLongConversation;
    }
  };
  window.__codexControlConsoleLongConversation = controller;
  reconcile();
  return controller.snapshot();
}

export function buildNativeLongConversationInjectionScript(eagerTurns = LONG_CONVERSATION_EAGER_TURNS) {
  return `(${installNativeLongConversation.toString()})(${JSON.stringify(eagerTurns)});`;
}
