// Top-left sidebar entry: a count badge and a panel of conversations marked as needing a
// restart. Idempotent; called on every entry-install tick. Data comes from the page store.
export function installNativeRestartNeedsEntry(documentRef = document) {
  const attribute = 'data-codex-control-console-restart-needs';
  const search = documentRef.querySelector('button[aria-label="搜索"],button[aria-label="Search"]');
  const host = search?.parentElement?.parentElement?.parentElement;
  const row = host?.classList?.contains('ms-auto') ? host.parentElement : null;
  const store = window.__codexControlConsoleRestartMarks;
  if (!row || !store) return null;
  let entry = documentRef.querySelector('[' + attribute + ']');
  if (!entry) {
    entry = documentRef.createElement('button');
    entry.type = 'button';
    entry.setAttribute(attribute, '');
    entry.setAttribute('aria-haspopup', 'dialog');
    entry.setAttribute('aria-expanded', 'false');
    entry.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v5h-5"/></svg><span data-restart-needs-badge hidden></span>';
    entry.style.cssText = 'position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:inherit;cursor:pointer;';
    for (const key of ['-webkit-app-region', 'app-region']) entry.style.setProperty(key, 'no-drag', 'important');
    entry.style.setProperty('pointer-events', 'auto', 'important');
    entry.addEventListener('mouseenter', () => { entry.style.background = 'color-mix(in srgb,currentColor 10%,transparent)'; });
    entry.addEventListener('mouseleave', () => { entry.style.background = 'transparent'; });
  }
  if (entry.parentElement !== row || entry.nextElementSibling !== host) row.insertBefore(entry, host);
  if (entry.subscribedStore === store) return entry;
  entry.subscribedStore = store;
  entry.unsubscribe?.();
  entry.panel?.remove();
  const style = documentRef.createElement('style');
  style.textContent = '[data-restart-needs-badge]{position:absolute;top:1px;right:0;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#e89a6c;color:#1b1b1d;font:700 10px/14px -apple-system,sans-serif;text-align:center}[data-restart-needs-badge][hidden]{display:none}[data-restart-needs-badge][data-verify-only="true"]{background:#7da9ff}' +
    '[data-restart-needs-panel]{position:fixed;z-index:2147483000;width:min(340px,calc(100vw - 24px));max-height:min(480px,calc(100vh - 100px));overflow:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:12px;padding:6px;background:var(--color-background-primary,#202022);color:var(--color-text,#eee);box-shadow:0 14px 42px rgba(0,0,0,.28);font:12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}[data-restart-needs-panel][hidden]{display:none}' +
    '[data-restart-needs-panel] h3{margin:0;padding:6px 8px;font:600 12px/18px inherit;opacity:.7}[data-restart-needs-panel] p{margin:0;padding:16px;text-align:center;opacity:.6}' +
    '.ccc-restart-needs-row{display:flex;align-items:center;gap:4px;border-radius:8px}.ccc-restart-needs-open{display:flex;min-width:0;flex:1;flex-direction:column;border:0;border-radius:8px;padding:7px 8px;background:transparent;color:inherit;text-align:left;cursor:pointer}' +
    '.ccc-restart-needs-open:hover,.ccc-restart-needs-open:focus-visible,.ccc-restart-needs-clear:hover{background:color-mix(in srgb,currentColor 9%,transparent);outline:none}.ccc-restart-needs-open b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 13px/17px inherit}.ccc-restart-needs-open span{font-size:11px;opacity:.58}' +
    '.ccc-restart-needs-clear{flex:0 0 auto;border:0;border-radius:7px;padding:4px 8px;background:transparent;color:inherit;font-size:11px;opacity:.7;cursor:pointer}';
  documentRef.head.append(style);
  const badge = entry.querySelector('[data-restart-needs-badge]');
  const panel = documentRef.createElement('div');
  panel.setAttribute('data-restart-needs-panel', '');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '需要重启或待验收的会话');
  panel.hidden = true;
  documentRef.body.append(panel);
  entry.panel = panel;
  const close = () => { panel.hidden = true; entry.setAttribute('aria-expanded', 'false'); };
  const stamp = (value) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const heading = (text) => { const node = documentRef.createElement('h3'); node.textContent = text; return node; };
  const action = (text, run) => { const button = documentRef.createElement('button'); button.type = 'button'; button.className = 'ccc-restart-needs-clear'; button.textContent = text; button.addEventListener('click', () => { void run(); }); return button; };
  const renderRow = (mark) => {
    const item = documentRef.createElement('div');
    item.className = 'ccc-restart-needs-row';
    const open = documentRef.createElement('button');
    open.type = 'button'; open.className = 'ccc-restart-needs-open';
    const title = documentRef.createElement('b'); title.textContent = mark.title;
    const detail = documentRef.createElement('span');
    const engine = mark.provider === 'terminal' ? 'Claude CLI' : '本地会话';
    detail.textContent = engine + (mark.status === 'verify' ? ' · 已于 ' + stamp(mark.restartedAt || mark.markedAt) + ' 重启' : ' · 标记于 ' + stamp(mark.markedAt));
    open.append(title, detail);
    open.addEventListener('click', () => { close(); window.__codexControlConsoleConversationTabs?.openMarked?.(mark); });
    item.append(open);
    if (mark.status === 'verify') item.append(action('已验收', () => store.resolve(mark.id, 'passed')), action('未通过', () => store.resolve(mark.id, 'failed')));
    else item.append(action('取消标记', () => store.set(mark, false)));
    return item;
  };
  const render = () => {
    const marks = store.list();
    const pendingRestart = marks.filter((mark) => mark.status !== 'verify'), pendingVerify = marks.filter((mark) => mark.status === 'verify');
    badge.hidden = !marks.length;
    badge.textContent = String(marks.length);
    badge.dataset.verifyOnly = String(!pendingRestart.length && pendingVerify.length > 0);
    const label = marks.length ? '需求 · ' + pendingRestart.length + ' 个需要重启，' + pendingVerify.length + ' 个待验收' : '需求 · 暂无需要重启或待验收的会话';
    entry.title = label; entry.setAttribute('aria-label', label);
    if (panel.hidden) return;
    if (!marks.length) {
      const empty = documentRef.createElement('p');
      empty.textContent = '暂无需要重启或待验收的会话';
      panel.replaceChildren(empty);
      return;
    }
    panel.replaceChildren(...(pendingRestart.length ? [heading('需要重启（整个应用重启后转为待验收）'), ...pendingRestart.map(renderRow)] : []), ...(pendingVerify.length ? [heading('待验收（重启后请确认是否达到要求）'), ...pendingVerify.map(renderRow)] : []));
  };
  entry.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    const opening = panel.hidden;
    panel.hidden = !opening;
    entry.setAttribute('aria-expanded', String(opening));
    if (!opening) return;
    const box = entry.getBoundingClientRect();
    panel.style.left = Math.max(8, Math.min(box.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
    panel.style.top = box.bottom + 6 + 'px';
    render();
    void store.refresh();
  });
  const outside = (event) => { if (!panel.hidden && !panel.contains(event.target) && !entry.contains(event.target)) close(); };
  const keyboard = (event) => { if (!panel.hidden && event.key === 'Escape') { event.preventDefault(); close(); entry.focus(); } };
  documentRef.addEventListener('pointerdown', outside, true);
  documentRef.addEventListener('keydown', keyboard, true);
  const unsubscribe = store.subscribe(render);
  entry.unsubscribe = () => { unsubscribe(); documentRef.removeEventListener('pointerdown', outside, true); documentRef.removeEventListener('keydown', keyboard, true); style.remove(); };
  render();
  return entry;
}
