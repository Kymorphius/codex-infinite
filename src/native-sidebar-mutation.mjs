// Serialized into native pages. Match changed subtrees, never scan the whole document.
export function nativeSidebarMutationPlan(records, documentRef, { ownSelector = '', ownedRoots = [], terminalTabs = false } = {}) {
  const native = '#app-shell-sidebar,[data-slate-sidebar-content],[data-app-action-sidebar-scroll],section[data-app-action-sidebar-section-heading],[data-app-action-sidebar-section-toggle],[data-app-action-sidebar-section-collapsed],[data-app-action-sidebar-project-list-id],[data-app-action-sidebar-project-id],[data-app-action-sidebar-project-row],[data-app-action-sidebar-project-collapsed],[data-app-action-sidebar-thread-id],[data-app-action-sidebar-thread-row],[data-app-action-sidebar-thread-selected],[data-sidebar-chatgpt-conversation-key]';
  const tabs = '[data-codex-control-console-native-tabs],[data-codex-control-console-conversation-shortcuts]';
  const element = node => node?.nodeType === 3 ? node.parentElement : node;
  const within = (node, selector) => Boolean(selector && element(node)?.closest?.(selector));
  const contains = (node, selector) => Boolean(element(node)?.matches?.(selector) || element(node)?.querySelector?.(selector));
  const moved = ownedRoots.some(({ node, parent, next, order }) => node.isConnected === false || node.parentElement !== parent
    || node.nextSibling !== next || order != null && node.style?.order !== order);
  let refresh = moved, templates = false;
  if (!records?.length) return { refresh: true, templates: true };
  for (const record of records) {
    const target = element(record.target);
    if (record.type === 'attributes' && (target === documentRef.documentElement || target === documentRef.body)
      && ['class', 'style', 'data-theme', 'data-color-scheme'].includes(record.attributeName)) { refresh = templates = true; continue; }
    if (within(target, ownSelector)) continue;
    const nodes = [...(record.addedNodes || []), ...(record.removedNodes || [])];
    // Internal replacement has new live roots and old detached roots. A moved live
    // root was handled above, including movement within the same parent.
    if (ownSelector && nodes.length && nodes.every(node => within(node, ownSelector) || element(node)?.matches?.(ownSelector))) continue;
    const ancestorAttribute = record.type === 'attributes' && ['class', 'style', 'hidden', 'aria-hidden'].includes(record.attributeName)
      && target !== documentRef.body && target !== documentRef.documentElement && contains(target, native);
    if (within(target, native) || ancestorAttribute || nodes.some(node => contains(node, native))) { refresh = templates = true; continue; }
    if (terminalTabs && (within(target, tabs) || nodes.some(node => contains(node, tabs)))) refresh = true;
  }
  return { refresh, templates };
}
