// Runs after every page mutation, so it must not force layout: innerText does, and with a dirty page
// each read cost a style recalc (85 per second). Labels are matched on textContent; innerText is only a
// tie-break for a candidate that starts with a label. `cache` remembers the anchor between calls.
export function findNativeEntryAnchor(documentRef, normalize, cache = null) {
  const NATIVE_ENTRY_LABELS = ['插件', 'Apps', '站点', 'Sites', '已安排', 'Scheduled'];
  const isAnchor = (element) => {
    const cheap = normalize(element.textContent ?? element.innerText);
    if (NATIVE_ENTRY_LABELS.includes(cheap)) return true;
    return NATIVE_ENTRY_LABELS.some((label) => cheap.startsWith(label)) && NATIVE_ENTRY_LABELS.includes(normalize(element.innerText || element.textContent));
  };
  if (cache?.node?.isConnected && isAnchor(cache.node)) return cache.node;
  const found = Array.from(documentRef.querySelectorAll('button.sidebar-item, button')).find(isAnchor) || null;
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

// Settings replaces the sidebar scroll container, so its absence means we left the normal layout.
export function nativeLayoutTransition(documentRef, wasNormal) {
  const normal = Boolean(documentRef.querySelector('[data-app-action-sidebar-scroll]'));
  return { normal, leftNormal: Boolean(wasNormal) && !normal };
}
