// Serialized into the native page. Move the original dot without changing its handlers.
export function positionNativeSidebarDot(documentRef, newChat) {
  const parent = newChat?.parentElement;
  const unavailable = node => {
    for (let current = node; current; current = current.parentElement) {
      if (current.isConnected === false || current.hidden || current.inert
        || current.hasAttribute?.('data-app-navigation-rail') || current.hasAttribute?.('hidden') || current.hasAttribute?.('inert')
        || current.getAttribute?.('aria-hidden') === 'true' || current.style?.display === 'none' || current.style?.visibility === 'hidden') return true;
    }
    return false;
  };
  if (!parent || unavailable(newChat)) return null;
  const label = String(newChat.getAttribute?.('aria-label') || newChat.textContent || '').replace(/\s+/g, ' ').trim();
  if (!['新聊天', '新对话', '新建任务', 'New chat', 'New task'].some(value => label === value || label.startsWith(value + ' '))) return null;
  const sameParent = selector => Array.from(documentRef.querySelectorAll(selector)).find(node => node.parentElement === parent && !unavailable(node));
  const dot = sameParent('[data-sidebar-destination="builtin:orbit"]');
  if (!dot) return null;
  // The Butler-only fallback also anchors after New chat; let its normal open-project anchor arrive first.
  if (sameParent('[data-codex-control-console-butler-entry]') && !sameParent('[data-codex-control-console-open-local-project]')) return null;
  if (dot.previousElementSibling !== newChat) parent.insertBefore(dot, newChat.nextSibling);
  return dot;
}
