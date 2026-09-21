export function readNativeChecklistConversationChoices(documentRef) {
  return [...documentRef.querySelectorAll('[data-app-action-sidebar-thread-id^="local:"]')]
    .map(row => ({ id: String(row.getAttribute('data-app-action-sidebar-thread-id') || '').slice(6).toLowerCase(), title: String(row.getAttribute('data-app-action-sidebar-thread-title') || row.textContent || '').trim() }))
    .filter(item => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id));
}
