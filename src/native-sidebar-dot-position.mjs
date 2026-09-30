// Serialized into the native page. Keep native controls in their React-owned parents.
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
  const dots = Array.from(documentRef.querySelectorAll('[data-sidebar-destination="builtin:orbit"]')).filter(node => !unavailable(node));
  let dot = dots.find(node => node.parentElement === parent), group = parent, branch = newChat;
  if (!dot) for (let candidate = parent; candidate?.parentElement; candidate = candidate.parentElement) {
    const nativeGroup = candidate.parentElement;
    if (unavailable(nativeGroup)) break;
    if (nativeGroup.hasAttribute?.('data-appearance') && String(nativeGroup.className || '').split(/\s+/).includes('group/nav-list')) {
      dot = dots.find(node => node.parentElement === nativeGroup);
      if (dot) { group = nativeGroup; branch = candidate; break; }
    }
    if (candidate.hasAttribute?.('data-slate-sidebar-content') || candidate.getAttribute?.('id') === 'app-shell-sidebar') break;
  }
  if (!dot) return null;
  const attributes = ['data-codex-control-console-butler-entry', 'data-codex-control-console-open-local-project', 'data-ccc-general-checklist-entry',
    'data-codex-control-console-kanban-entry', 'data-codex-control-console-entry', 'data-codex-control-console-session-entry',
    'data-codex-control-console-priority-entry', 'data-codex-control-console-project-search'];
  const belongs = node => {
    if (node.parentElement === group) return true;
    for (let current = node.parentElement; current; current = current.parentElement) if (current === branch) return true;
    return false;
  };
  const added = Array.from(documentRef.querySelectorAll(attributes.map(attribute => '[' + attribute + ']').join(','))).filter(node => belongs(node) && !unavailable(node));
  const entry = attribute => added.find(node => node.hasAttribute(attribute));
  // The Butler-only fallback also anchors after New chat; let its normal open-project anchor arrive first.
  if (entry(attributes[0]) && !entry(attributes[1])) return null;
  if (group === parent) {
    if (dot.previousElementSibling !== newChat) parent.insertBefore(dot, newChat.nextSibling);
  } else {
    // The latest New chat drag/drop wrapper contains enhanced rows; promote only our rows.
    let previous = dot;
    for (const attribute of attributes) {
      const node = entry(attribute);
      if (!node) continue;
      if (node.parentElement !== group || node.previousElementSibling !== previous) group.insertBefore(node, previous.nextSibling);
      previous = node;
    }
  }
  return dot;
}
