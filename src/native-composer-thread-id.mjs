// The mounted composer is authoritative, but it is briefly absent during a
// native route transition. The sidebar's selected row is the stable fallback.
export function readNativeComposerThreadId(documentRef) {
  const threadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const normalize = (value) => {
    const id = String(value || "").trim().replace(/^local:/i, "");
    return threadIdPattern.test(id) ? id.toLowerCase() : null;
  };
  const mounted = documentRef.querySelectorAll("[data-above-composer-conversation-id]");
  for (let index = mounted.length - 1; index >= 0; index -= 1) {
    const id = normalize(mounted[index].getAttribute("data-above-composer-conversation-id"));
    if (id) return id;
  }
  const selected = documentRef.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"],[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected="true"]');
  return normalize(selected?.getAttribute("data-app-action-sidebar-thread-id"));
}
