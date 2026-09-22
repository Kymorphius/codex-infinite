// Kept self-contained so native injection can serialize this function verbatim.
export function installNativeTurboTurnRenderer({ hostWindow, documentRef, readThreadId, getReceipts, formatLabel }) {
  const badgeAttribute = "data-codex-control-console-turbo-turn";
  const badgeSelector = "[" + badgeAttribute + "]";
  const signatureAttribute = "data-codex-control-console-turbo-turn-signature";
  const turnSelector = "[data-content-search-turn-key]";
  const bubbleSelector = "[data-user-message-bubble]";
  const composerSelector = "[data-above-composer-conversation-id]";
  const mountSelector = turnSelector + "," + bubbleSelector + "," + composerSelector;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const observedTurns = new WeakMap();
  const enqueue = hostWindow.queueMicrotask?.bind(hostWindow) || ((callback) => Promise.resolve().then(callback));
  let queued = false;
  let disposed = false;
  let fallbackChildren = !hostWindow.__codexControlConsoleObserver;
  let observer = null;

  function observe() {
    observer?.observe(documentRef.documentElement || documentRef, {
      subtree: true, childList: fallbackChildren, attributes: true,
      attributeFilter: ["data-content-search-turn-key", "data-above-composer-conversation-id"]
    });
  }

  function normalizeId(value) {
    return typeof value === "string" && uuid.test(value) ? value.toLowerCase() : null;
  }

  function afterBubble(badge, bubble) {
    if (badge.parentElement !== bubble.parentElement) return false;
    for (let sibling = bubble.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      if (sibling === badge) return true;
    }
    return false;
  }

  function render() {
    if (disposed) return;
    const threadId = normalizeId(readThreadId(documentRef));
    const receipts = new Map();
    for (const receipt of getReceipts() || []) {
      if (threadId && normalizeId(receipt?.threadId) === threadId && normalizeId(receipt?.turnId)) {
        receipts.set(normalizeId(receipt.turnId), receipt);
      }
    }
    for (const turn of documentRef.querySelectorAll(turnSelector)) {
      const turnId = normalizeId(turn.getAttribute("data-content-search-turn-key"));
      observedTurns.set(turn, turnId);
      const receipt = turnId ? receipts.get(turnId) : null;
      const label = receipt ? formatLabel(receipt) : "";
      const bubble = turn.querySelector(bubbleSelector);
      let badge = turn.querySelector(badgeSelector);
      if (!label || !bubble?.parentElement) { badge?.remove(); continue; }
      if (!badge) {
        badge = documentRef.createElement("div");
        badge.setAttribute(badgeAttribute, "");
        badge.style.cssText = 'align-self:flex-end;display:inline-flex;max-width:100%;height:22px;align-items:center;padding:0 8px;border:1px solid rgba(218,175,75,.38);border-radius:999px;background:rgba(202,155,47,.10);color:#d6b363;font:600 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9;';
      }
      if (!afterBubble(badge, bubble)) bubble.after(badge);
      const signature = JSON.stringify([threadId, turnId, label, receipt.source]);
      if (badge.getAttribute(signatureAttribute) === signature) continue;
      const provenance = receipt.source === "turn-start-request" ? "Turbo 发送参数" : "轮次开始时已验证的 Turbo 原生设置";
      badge.textContent = label;
      badge.title = provenance + "。这是本轮发送时的设置，并非上游模型回执；若启用 Jev 路由，最终路由结果请参见 Jev 轮次标签。";
      badge.setAttribute("aria-label", "本轮 " + label);
      badge.setAttribute(signatureAttribute, signature);
    }
  }

  function owned(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(element?.closest?.(badgeSelector));
  }

  function containsMount(node) {
    return node?.nodeType === 1 && !owned(node)
      && Boolean(node.matches?.(mountSelector) || node.querySelector?.(mountSelector));
  }

  function reusedTurn(node) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    const turn = element?.closest?.(turnSelector);
    return turn && observedTurns.has(turn)
      && observedTurns.get(turn) !== normalizeId(turn.getAttribute("data-content-search-turn-key"));
  }

  function relevant(record) {
    if (!record || owned(record.target)) return false;
    if (record.type === "attributes") {
      return (record.attributeName === "data-content-search-turn-key" && record.target?.matches?.(turnSelector))
        || (record.attributeName === "data-above-composer-conversation-id" && record.target?.matches?.(composerSelector));
    }
    if (record.type !== "childList") return false;
    return reusedTurn(record.target)
      || Array.from(record.addedNodes || []).some(containsMount)
      || Array.from(record.removedNodes || []).some(containsMount);
  }

  function receive(records) {
    if (fallbackChildren && hostWindow.__codexControlConsoleObserver) {
      fallbackChildren = false;
      observer?.disconnect();
      observe();
    }
    if (disposed || queued || !Array.from(records || []).some(relevant)) return;
    queued = true;
    enqueue(() => { queued = false; if (!disposed) render(); });
  }

  const subscribers = hostWindow.__codexControlConsoleMutationSubscribers ||= new Set();
  subscribers.add(receive);
  if (typeof hostWindow.MutationObserver === "function") {
    observer = new hostWindow.MutationObserver(receive);
    observe();
  }
  return {
    render,
    cleanup() {
      disposed = true;
      subscribers.delete(receive);
      observer?.disconnect();
      documentRef.querySelectorAll(badgeSelector).forEach((badge) => badge.remove());
    }
  };
}
