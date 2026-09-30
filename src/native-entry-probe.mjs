// Runs after every page mutation, so it must not force layout: innerText does, and with a dirty page
// each read cost a style recalc (85 per second). Labels are matched on textContent; innerText is only a
// tie-break for a candidate that starts with a label. `cache` remembers the anchor between calls.
export function findNativeEntryAnchor(documentRef, normalize, cache = null) {
  const NEW_CHAT_LABELS = ['新聊天', '新对话', '新建任务', 'New chat', 'New task'];
  const LEGACY_LABELS = ['插件', 'Apps', '站点', 'Sites', '已安排', 'Scheduled'];
  const PANE = '#app-shell-sidebar, [data-slate-sidebar-content]';
  const pane = documentRef.querySelector?.('#app-shell-sidebar [data-slate-sidebar-content], [data-slate-sidebar-content]')
    || documentRef.querySelector?.('#app-shell-sidebar') || null;
  const paneOf = element => element.closest?.('[data-slate-sidebar-content]') || element.closest?.('#app-shell-sidebar') || null;
  const eligible = element => {
    if (!element || element.isConnected === false) return false;
    if (element.closest?.('[data-app-navigation-rail], [role="dialog"], [role="menu"], [role="menuitem"]')) return false;
    for (let node = element; node; node = node.parentElement) {
      if (node.hidden || node.inert || node.hasAttribute?.('hidden') || node.hasAttribute?.('inert')
        || node.getAttribute?.('aria-hidden') === 'true' || node.getAttribute?.('data-app-shell-sidebar-open') === 'false'
        || node.style?.display === 'none' || node.style?.visibility === 'hidden') return false;
    }
    if (Array.from(element.attributes || []).some(attribute => /^(?:data-ccc-|data-codex-control-console-)/.test(attribute.name))) return false;
    if (String(element.className || '').split(/\s+/).some(name => name.startsWith('ccc-'))) return false;
    return !pane || paneOf(element) === pane;
  };
  const matchesLabel = (element, labels) => {
    const cheap = normalize(element.getAttribute?.('aria-label') || (element.textContent ?? element.innerText ?? ''));
    if (labels.includes(cheap)) return true;
    return labels.some(label => cheap.startsWith(label)) && labels.includes(normalize(element.innerText || element.textContent || ''));
  };
  if (pane && !eligible(pane)) { if (cache) cache.node = null; return null; }
  if (cache?.node?.isConnected && eligible(cache.node)
    && (pane ? matchesLabel(cache.node, NEW_CHAT_LABELS) : !cache.node.closest?.(PANE) && matchesLabel(cache.node, LEGACY_LABELS))) return cache.node;
  const candidates = Array.from(documentRef.querySelectorAll('button.sidebar-item, button, [role="button"]')).filter(eligible);
  const found = (pane && candidates.find(element => matchesLabel(element, NEW_CHAT_LABELS)))
    || candidates.find(element => matchesLabel(element, LEGACY_LABELS)) || null;
  if (cache) cache.node = found;
  return found;
}

export function nativeEntryMutationNeedsInstall(records) {
  return !records?.length || records.some((record) => !record.target?.closest?.('[data-thread-user-message-navigation-content]'));
}

export function injectionDecision({ hasEntry, hasAnchor }) {
  if (hasEntry) return 'already-installed';
  if (hasAnchor) return 'install-native-entry';
  return 'wait-for-native-entry';
}

// Latest layouts keep their top actions in a text pane, outside the lower sidebar scroll container.
// Settings replaces those surfaces; legacy layouts still use the scroll marker.
export function nativeLayoutTransition(documentRef, wasNormal) {
  const pane = documentRef.querySelector('#app-shell-sidebar [data-slate-sidebar-content], [data-slate-sidebar-content], #app-shell-sidebar');
  const normal = Boolean(pane || documentRef.querySelector('[data-app-action-sidebar-scroll]'));
  return { normal, leftNormal: Boolean(wasNormal) && !normal };
}
