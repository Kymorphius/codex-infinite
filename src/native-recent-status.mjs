// Icons flag only states worth a look (running, unread, interrupted, error, pending).
// Completed-and-read native rows and idle or stopped Claude rows stay quiet: the slot is
// kept for alignment but left empty. Claude rows read Claude's own busy/idle registration.
export function updateClaudeStatus(dot, record) {
  const claude = record?.claudeStatus;
  const status = claude === 'busy' ? 'active' : claude === 'idle' ? 'completed' : 'unknown';
  const label = claude === 'busy' ? 'Claude 工作中' : claude === 'idle' ? 'Claude 空闲' : 'Claude 未运行';
  if (dot.statusSignature === label) return;
  dot.statusSignature = label; dot.replaceChildren();
  dot.dataset.status = status; dot.dataset.unread = 'false'; dot.dataset.statusSource = 'fallback'; dot.dataset.nativeRunning = 'false';
  dot.dataset.quiet = String(claude !== 'busy');
  dot.setAttribute('aria-label', label); dot.setAttribute('title', label);
}

export function updateNativeRecentStatus(documentRef, row, tab, live, terminalRecords = () => [], now = Date.now()) {
  const dot = row.statusDot;
  if (tab.kind === 'terminal' && tab.engine !== 'shell') return updateClaudeStatus(dot, terminalRecords().find(record => record.id === tab.id));
  if (tab.kind !== 'local' || !/^[0-9a-f-]{36}$/i.test(tab.id || '')) return;
  const nativeRow = documentRef.querySelector?.(`[data-app-action-sidebar-thread-id="local:${tab.id}"],[data-app-action-sidebar-thread-id="${tab.id}"]`);
  const rail = Array.from(nativeRow?.querySelectorAll?.('div') || []).find(node => node.classList?.contains('absolute')
    && node.classList.contains('end-0') && node.classList.contains('group-hover:hidden') && node.children.length > 0);
  const running = Boolean(rail?.querySelector?.('[class~="motion-safe:animate-spin"]'));
  const status = running ? 'active' : live?.status || tab.status || 'unknown';
  const unread = typeof live?.unread === 'boolean' ? String(live.unread) : 'unknown';
  // A turn stopped by an exhausted quota gets its own mark until the quota resets.
  const resetAt = Date.parse(live?.quotaResetsAt || tab.quotaResetsAt || '');
  if (['interrupted', 'error'].includes(status) && resetAt > now) {
    const label = '额度已用完 · ' + new Date(resetAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' 重置';
    if (dot.statusSignature === label) return;
    dot.statusSignature = label; dot.replaceChildren();
    dot.dataset.status = 'quota'; dot.dataset.unread = unread; dot.dataset.statusSource = 'fallback'; dot.dataset.nativeRunning = 'false'; dot.dataset.quiet = 'false';
    dot.setAttribute('aria-label', label); dot.setAttribute('title', label);
    return;
  }
  const quiet = status === 'completed' && unread === 'false';
  const svg = status !== 'unknown' && status !== 'completed' ? rail?.querySelector?.('svg') : null;
  const signature = JSON.stringify([status, unread, svg?.outerHTML, running]);
  if (dot.statusSignature === signature) return;
  dot.statusSignature = signature; dot.replaceChildren();
  dot.dataset.status = status; dot.dataset.unread = unread;
  dot.dataset.statusSource = svg?.cloneNode ? 'native' : 'fallback';
  dot.dataset.nativeRunning = String(running); dot.dataset.quiet = String(quiet);
  if (svg?.cloneNode) dot.append(svg.cloneNode(true));
  const label = status === 'completed' ? (unread === 'true' ? '已完成，未读' : unread === 'false' ? '已完成，已读' : '已完成，阅读状态未知')
    : ({ active: '进行中', pending: '待处理', interrupted: '已中断', error: '出错' })[status] || '状态未知';
  dot.setAttribute('aria-label', label); dot.setAttribute('title', label);
}
