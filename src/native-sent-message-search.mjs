import { NATIVE_SIDEBAR_ORDER } from './native-sidebar-order.mjs';
export const SENT_MESSAGE_SEARCH_BINDING = '__codexControlConsoleSearchSentMessages';

export function buildNativeSentMessageSearchInjectionScript() {
  return `(${installNativeSentMessageSearch.toString()})(${NATIVE_SIDEBAR_ORDER.sentMessageSearch})`;
}

export async function respondToSentMessageSearch(payload, connection, service) {
  let request;
  try { request = JSON.parse(payload); } catch { return; }
  if (!Number.isSafeInteger(request?.id) || request.id < 0 || typeof request.query !== 'string' || request.query.length > 120) return;
  let result;
  try { result = await service.search(request.query); }
  catch { result = { items: [], incomplete: true, error: '搜索暂时不可用' }; }
  const encoded = JSON.stringify({ id: request.id, ...result }).replace(/</g, '\\u003c');
  await connection.evaluate(`window.__codexControlConsoleSentMessageSearch?.receive(${encoded})`);
}

export function installNativeSentMessageSearch(order = 11) {
  const VERSION = '2026-09-28.terminal-shortcuts';
  if (window.__codexControlConsoleSentMessageSearch?.version === VERSION) {
    window.__codexControlConsoleSentMessageSearch.ensure?.();
    return;
  }
  window.__codexControlConsoleSentMessageSearch?.dispose?.();
  const HISTORY_KEY = 'codex-control-console.sent-message-search.history.v1';
  let root, topLaunch, panel, input, results, historyPanel, timer, requestId = 0, active = false, lastLauncher = null, searchedQuery = '';
  let history = [];
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (Array.isArray(saved)) history = saved.filter(value => typeof value === 'string' && value.trim() && value.length <= 120).slice(0, 10);
  } catch { /* Search remains available without stored history. */ }
  const make = (tag, cls, value) => {
    const node = document.createElement(tag); node.className = cls;
    if (value != null) node.textContent = value;
    return node;
  };
  const status = value => {
    const node = make('div', 'px-1 py-1 text-sm text-tertiary', value);
    Object.assign(node.style, { padding: '7px 4px', color: '#aaa', fontSize: '13px' });
    return node;
  };
  function saveHistory(query) {
    const value = query.trim();
    if (!value || value.length > 120) return;
    history = [value, ...history.filter(item => item !== value)].slice(0, 10);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch { /* In-memory history still works. */ }
  }
  function renderHistory() {
    if (!historyPanel) return;
    historyPanel.replaceChildren();
    historyPanel.hidden = Boolean(input?.value.trim()) || !history.length;
    if (historyPanel.hidden) return;
    const heading = make('div', '', null);
    Object.assign(heading.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px', color: '#aaa', fontSize: '12px' });
    heading.append(make('span', '', '搜索历史'));
    const clear = make('button', '', '清空');
    clear.type = 'button'; clear.setAttribute('aria-label', '清空消息搜索历史');
    Object.assign(clear.style, { border: '0', background: 'transparent', color: '#aaa', cursor: 'pointer' });
    clear.addEventListener('click', () => {
      history = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* In-memory history is cleared. */ }
      renderHistory(); input.focus();
    });
    heading.append(clear); historyPanel.append(heading);
    for (const query of history) {
      const row = make('button', '', query);
      row.type = 'button'; row.setAttribute('data-sent-message-search-history', query);
      Object.assign(row.style, { display: 'block', boxSizing: 'border-box', width: '100%', padding: '7px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left', border: '0', borderRadius: '5px', background: 'transparent', color: '#ddd', cursor: 'pointer' });
      row.addEventListener('click', () => { input.value = query; search(); input.focus(); });
      historyPanel.append(row);
    }
  }
  function show(value) {
    if (!results) return;
    results.replaceChildren();
    if (!input?.value.trim()) return;
    if (typeof value === 'string') {
      results.append(status(value));
      return;
    }
    const indexing = value.indexing && !value.indexing.ready ?
      ` · 正在建立索引 ${value.indexing.indexed}/${value.indexing.total}` : '';
    results.append(status(value.error ||
      (value.items.length ? `${value.items.length} 个会话${value.incomplete && !indexing ? ' · 结果可能不完整' : ''}` :
        indexing ? '已索引范围内暂无匹配' : value.incomplete ? '没有匹配结果 · 部分历史暂不可读取' : '没有匹配的已发送消息') + indexing));
    for (const item of value.items) {
      const row = make('button', 'sidebar-item w-full px-2 py-1 text-start hover:bg-primary-ghost-hover');
      Object.assign(row.style, { display: 'block', width: '100%', padding: '10px', textAlign: 'left', background: 'transparent', color: 'inherit', border: '0', borderBottom: '1px solid #383838', cursor: 'pointer' });
      row.type = 'button'; row.setAttribute('data-sent-message-search-thread-id', item.id);
      const title = make('div', 'truncate text-sm text-default', item.title);
      Object.assign(title.style, { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: '600' });
      const excerpt = make('div', 'line-clamp-2 text-xs text-tertiary', item.excerpt);
      Object.assign(excerpt.style, { marginTop: '4px', color: '#b5b5b5', fontSize: '12px', lineHeight: '1.5', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' });
      row.append(title, excerpt);
      if (item.kind === 'terminal') {
        const engine = make('span', '', 'Claude CLI');
        Object.assign(engine.style, { marginLeft: '8px', padding: '0 6px', borderRadius: '999px', fontSize: '11px', fontWeight: '500', color: '#d9a640', background: 'rgba(217,166,64,.14)' });
        title.append(engine);
      }
      row.addEventListener('click', () => {
        saveHistory(input.value);
        close();
        if (item.kind === 'terminal') {
          const record = window.__cccTerminalConversations?.records?.().find(value => value.id === item.id);
          void window.__codexControlConsoleOpenTerminalConversation?.(record || { provider: 'terminal', conversationId: item.id, deviceId: item.deviceId });
          return;
        }
        window.__codexControlConsoleClose?.();
        window.__codexControlConsoleConversationTabs?.openLocal?.({ id: item.id, title: item.title });
        window.postMessage({ type: 'navigate-to-route', path: '/local/' + item.id }, '*');
      });
      results.append(row);
    }
  }
  function search() {
    clearTimeout(timer);
    const query = input?.value.trim() || '';
    requestId++;
    if (!query) { searchedQuery = ''; results?.replaceChildren(); renderHistory(); return; }
    renderHistory();
    show('搜索本机消息中…');
    const id = requestId;
    timer = setTimeout(() => {
      if (typeof window.__codexControlConsoleSearchSentMessages === 'function') {
        searchedQuery = query;
        window.__codexControlConsoleSearchSentMessages(JSON.stringify({ id, query }));
      } else show('搜索暂时不可用');
    }, 350);
  }
  function close() {
    if (searchedQuery && searchedQuery === input?.value.trim()) saveHistory(searchedQuery);
    panel.hidden = true;
    panel.style.display = 'none';
    requestId++;
    clearTimeout(timer);
    (lastLauncher?.isConnected ? lastLauncher : root?.querySelector?.('button'))?.focus?.();
  }
  function open(event) {
    lastLauncher = event?.currentTarget || root?.querySelector?.('button');
    requestId++;
    clearTimeout(timer);
    searchedQuery = '';
    input.value = '';
    results.replaceChildren();
    renderHistory();
    panel.hidden = false;
    panel.style.display = 'flex';
    input.focus();
  }
  function install() {
    const projectSearch = document.querySelector('[data-codex-control-console-project-search]');
    const shortcuts = document.querySelector('[data-codex-control-console-conversation-shortcuts]');
    if (!projectSearch?.parentElement && !shortcuts) return;
    if (!root) {
      root = make('div', projectSearch?.className || 'group/nav-section relative px-row-x py-1', null);
      root.setAttribute('data-codex-control-console-sent-message-search', '');
      const launch = make('button', 'sidebar-item w-full rounded-md px-2 py-1 text-start text-sm text-default hover:bg-primary-ghost-hover', '搜索发送内容');
      launch.type = 'button'; launch.setAttribute('aria-haspopup', 'dialog'); launch.addEventListener('click', open);
      root.append(launch);
      topLaunch = make('button', 'ccc-native-recent-trigger', null);
      topLaunch.type = 'button';
      topLaunch.setAttribute('data-codex-control-console-tab-message-search', '');
      topLaunch.setAttribute('aria-label', '搜索已发送消息');
      topLaunch.setAttribute('aria-haspopup', 'dialog');
      topLaunch.title = '搜索已发送消息';
      topLaunch.style.flex = '0 0 auto';
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '15'); icon.setAttribute('height', '15');
      icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.8');
      icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('aria-hidden', 'true');
      const lens = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      lens.setAttribute('cx', '10.8'); lens.setAttribute('cy', '10.8'); lens.setAttribute('r', '6.6'); icon.append(lens);
      const handle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      handle.setAttribute('d', 'm16 16 4.2 4.2'); icon.append(handle);
      topLaunch.append(icon, make('span', '', '消息搜索'));
      topLaunch.addEventListener('click', open);
      panel = make('div', 'fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-6 pt-[10vh]', null);
      Object.assign(panel.style, {
        position: 'fixed', inset: '0', zIndex: '2147483000', boxSizing: 'border-box',
        alignItems: 'flex-start', justifyContent: 'center', padding: 'min(10vh, 90px) 20px 20px',
        background: 'rgba(0, 0, 0, 0.72)'
      });
      panel.hidden = true;
      panel.style.display = 'none';
      panel.setAttribute('data-codex-control-console-sent-message-panel', '');
      panel.addEventListener('click', event => { if (event.target === panel) close(); });
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
      const dialog = make('div', 'w-full max-w-2xl rounded-xl border border-token-border-default bg-primary p-4 shadow-xl', null);
      Object.assign(dialog.style, {
        boxSizing: 'border-box', width: '100%', maxWidth: '720px', maxHeight: '80vh',
        overflow: 'hidden', border: '1px solid #505050', borderRadius: '14px',
        background: '#202020', color: '#f5f5f5', padding: '20px',
        boxShadow: '0 20px 65px rgba(0, 0, 0, 0.55)'
      });
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', '搜索已发送消息');
      const heading = make('div', 'mb-3 flex items-center justify-between text-base text-default', null);
      Object.assign(heading.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', fontSize: '17px' });
      heading.append(make('span', '', '搜索已发送消息'));
      const dismiss = make('button', 'rounded px-2 py-1 text-sm text-tertiary', '关闭');
      Object.assign(dismiss.style, { padding: '4px 8px', background: 'transparent', color: '#ccc', border: '0', cursor: 'pointer' });
      dismiss.type = 'button'; dismiss.addEventListener('click', close); heading.append(dismiss);
      const bar = make('div', 'flex items-center rounded-md border border-token-border-default px-2');
      Object.assign(bar.style, { display: 'flex', alignItems: 'center', padding: '0 10px', border: '1px solid #606060', borderRadius: '8px' });
      input = make('input', 'min-w-0 flex-1 bg-transparent py-1 text-base text-default outline-none');
      Object.assign(input.style, { flex: '1', minWidth: '0', background: 'transparent', color: '#f5f5f5', border: '0', outline: '0', padding: '10px 0', fontSize: '15px' });
      input.type = 'search'; input.placeholder = '输入你发送过的文字';
      input.setAttribute('aria-label', '搜索本机已发送消息');
      input.addEventListener('input', search);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Enter' && input.value.trim()) { saveHistory(input.value); search(); }
      });
      historyPanel = make('div', '', null);
      historyPanel.setAttribute('aria-label', '消息搜索历史');
      historyPanel.style.marginTop = '10px';
      results = make('div', 'flex flex-col', null);
      results.setAttribute('aria-label', '已发送消息搜索结果');
      results.style.maxHeight = '60vh'; results.style.overflowY = 'auto';
      results.style.marginTop = '10px';
      const scope = make('div', 'my-2 text-xs text-tertiary', '搜索范围：本机未归档 Codex 与 Claude CLI 会话中你发送的消息');
      Object.assign(scope.style, { margin: '10px 0', color: '#aaa', fontSize: '12px' });
      bar.append(input); dialog.append(heading, bar, scope, historyPanel, results);
      panel.append(dialog); document.body.append(panel);
      root.addEventListener('pointerdown', event => event.stopPropagation());
    }
    if (projectSearch?.parentElement && (root.parentElement !== projectSearch.parentElement || root.previousSibling !== projectSearch)) {
      root.className = projectSearch.className;
      root.style.order = String(order);
      projectSearch.parentElement.insertBefore(root, projectSearch.nextSibling);
    }
    if (shortcuts) {
      const recent = shortcuts.querySelector('[data-recent-menu]');
      if (topLaunch.parentElement !== shortcuts || topLaunch.nextSibling !== recent) shortcuts.insertBefore(topLaunch, recent);
    }
  }
  window.__codexControlConsoleSentMessageSearch = {
    version: VERSION,
    ensure() {
      if (!active) return;
      install();
    },
    receive(value) { if (value?.id === requestId && input?.value.trim()) show(value); },
    dispose() { active = false; clearTimeout(timer); root?.remove(); topLaunch?.remove(); panel?.remove(); }
  };
  active = true;
  install();
}
