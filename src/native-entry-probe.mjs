export function findNativeEntryAnchor(documentRef, normalize) {
  return Array.from(documentRef.querySelectorAll('button.sidebar-item, button')).find((element) => {
    const text = normalize(element.innerText || element.textContent);
    return ['插件', 'Apps', '站点', 'Sites', '已安排', 'Scheduled'].includes(text);
  }) || null;
}

export function nativeEntryMutationNeedsInstall(records) {
  return !records?.length || records.some((record) => !record.target?.closest?.('[data-thread-user-message-navigation-content]'));
}

export function injectionDecision({ hasEntry, hasAnchor }) {
  if (hasEntry) return 'already-installed';
  if (hasAnchor) return 'install-native-entry';
  return 'wait-for-native-entry';
}
