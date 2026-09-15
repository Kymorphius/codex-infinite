export function resolveNativeLocalConversationId(mountedIds = [], selectedId = "") {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const mounted = Array.isArray(mountedIds) ? mountedIds : [];
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    const id = String(mounted[index] || "").trim();
    if (uuid.test(id)) return id.toLowerCase();
  }
  const fallback = String(selectedId || "").replace(/^local:/i, "").trim();
  return uuid.test(fallback) ? fallback.toLowerCase() : "";
}

export function buildNativeLocalConversationSyncSource() {
  return `
  ${resolveNativeLocalConversationId.toString()}
  function nativeLocalTitle(row, clean) {
    const nativeTitle = row.getAttribute('data-app-action-sidebar-thread-title');
    const trigger = row.querySelector('[data-thread-title="true"],[data-thread-title-trigger]');
    const candidates = trigger ? [trigger] : Array.from(row.querySelectorAll('.truncate, span')).filter((node) => !node.closest('[data-codex-control-console-sidebar-labels]'));
    return clean(nativeTitle || candidates.find((node) => clean(node.textContent, 160))?.textContent || row.getAttribute('aria-label'), 160) || '本地会话';
  }
  function readNativeLocalConversation(documentRef, state, clean) {
    const selected = documentRef.querySelector('[data-app-action-sidebar-thread-id^="local:"][data-app-action-sidebar-thread-selected="true"]');
    const selectedRaw = selected?.getAttribute('data-app-action-sidebar-thread-id') || '';
    const mountedIds = Array.from(documentRef.querySelectorAll('[data-above-composer-conversation-id]')).map((node) => node.getAttribute('data-above-composer-conversation-id'));
    const id = resolveNativeLocalConversationId(mountedIds, selectedRaw);
    if (!id) return null;
    const sourceRow = documentRef.querySelector('[data-app-action-sidebar-thread-id="local:' + id + '"]');
    const existing = state.tabs.find((tab) => tab.kind === 'local' && tab.id === id);
    return { id, title: sourceRow ? nativeLocalTitle(sourceRow, clean) : existing?.title };
  }
  function routeChanged(records) {
    const selector = '[data-above-composer-conversation-id]';
    return records.some((record) => record.attributeName === 'data-above-composer-conversation-id' || Array.from(record.addedNodes || []).some((node) => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))));
  }
  `;
}
