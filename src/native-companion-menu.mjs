// Adds one item to the native Codex thread context menu: open the thread's companion Claude
// CLI session, or create it when there is none. Serialized into the renderer with the terminal
// provider, so it must stay dependency-free. Native menu items and rows are never modified.
export function installNativeCompanionMenu({ documentRef, records, companion, windowMs = 2000 }) {
  let target = null, scheduled = false;
  const item = documentRef.createElement('div');
  item.setAttribute('role', 'menuitem'); item.tabIndex = -1; item.dataset.cccCompanionMenuItem = '';
  // Remember which local thread row was right-clicked; any other context menu clears it.
  function remember(event) {
    const row = event.target?.closest?.('[data-app-action-sidebar-thread-id^="local:"]');
    const threadId = row?.getAttribute('data-app-action-sidebar-thread-id')?.slice(6).toLowerCase() || '';
    target = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(threadId) ? { threadId, at: Date.now() } : null;
    if (!target) item.remove();
  }
  function openMenu() {
    return [...documentRef.querySelectorAll('[role="menu"]')].find(node => node.getAttribute('data-state') !== 'closed'
      && node.getBoundingClientRect().width > 0) || null;
  }
  // The first native menu that opens right after that right-click is the thread's menu.
  function place() {
    scheduled = false;
    if (!target) return;
    const menu = openMenu();
    if (!menu) { item.remove(); if (Date.now() - target.at > windowMs) target = null; return; }
    if (item.parentElement === menu) return;
    if (Date.now() - target.at > windowMs) { target = null; return; }
    const existing = records().some(record => record.companionOf === target.threadId && !record.archived);
    item.textContent = existing ? '打开伴生 Claude 会话' : '新建伴生 Claude 会话';
    item.title = existing ? '在终端中打开这个会话的伴生 Claude CLI 会话' : '读取这个会话的最近记录，新建一个共享上下文的 Claude CLI 会话（使用 Claude 订阅额度）';
    item.dataset.threadId = target.threadId;
    item.className = menu.querySelector('[role="menuitem"]:not([data-ccc-companion-menu-item])')?.className || '';
    menu.append(item);
  }
  function schedule() { if (!scheduled && target) { scheduled = true; requestAnimationFrame(place); } }
  function choose(event) {
    event.preventDefault(); event.stopPropagation();
    const threadId = item.dataset.threadId;
    item.remove(); target = null;
    documentRef.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    if (threadId) void companion(threadId);
  }
  item.addEventListener('click', choose);
  item.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') choose(event); });
  documentRef.addEventListener('contextmenu', remember, true);
  const observer = new MutationObserver(schedule);
  observer.observe(documentRef.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
  return { place, dispose() { observer.disconnect(); documentRef.removeEventListener('contextmenu', remember, true); item.remove(); } };
}
