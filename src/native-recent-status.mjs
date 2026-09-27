export function updateNativeRecentStatus(documentRef, row, tab, live) {
  const dot = row.statusDot;
  if (tab.kind !== 'local' || !/^[0-9a-f-]{36}$/i.test(tab.id || '')) return;
  const nativeRow = documentRef.querySelector?.(`[data-app-action-sidebar-thread-id="local:${tab.id}"],[data-app-action-sidebar-thread-id="${tab.id}"]`);
  const rail = Array.from(nativeRow?.querySelectorAll?.('div') || []).find(node => node.classList?.contains('absolute')
    && node.classList.contains('end-0') && node.classList.contains('group-hover:hidden') && node.children.length > 0);
  const running = Boolean(rail?.querySelector?.('[class~="motion-safe:animate-spin"]'));
  const status = running ? 'active' : live?.status || tab.status || 'unknown';
  const unread = typeof live?.unread === 'boolean' ? String(live.unread) : 'unknown';
  const svg = status !== 'unknown' && (status !== 'completed' || unread === 'false') ? rail?.querySelector?.('svg') : null;
  const signature = JSON.stringify([status, unread, svg?.outerHTML, running]);
  if (dot.statusSignature === signature) return;
  dot.statusSignature = signature; dot.replaceChildren();
  dot.dataset.status = status; dot.dataset.unread = unread;
  dot.dataset.statusSource = svg?.cloneNode ? 'native' : 'fallback';
  dot.dataset.nativeRunning = String(running);
  if (svg?.cloneNode) dot.append(svg.cloneNode(true));
  const label = status === 'completed' ? (unread === 'true' ? '已完成，未读' : unread === 'false' ? '已完成，已读' : '已完成，阅读状态未知')
    : ({ active: '进行中', pending: '待处理', interrupted: '已中断', error: '出错' })[status] || '状态未知';
  dot.setAttribute('aria-label', label); dot.setAttribute('title', label);
}
