export const SENT_MESSAGE_SEARCH_BINDING = '__codexControlConsoleSearchSentMessages';

export function buildNativeSentMessageSearchInjectionScript() {
  return `(${installNativeSentMessageSearch.toString()})()`;
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

export function installNativeSentMessageSearch() {
  const VERSION = '2026-09-23.1';
  if (window.__codexControlConsoleSentMessageSearch?.version === VERSION) return;
  window.__codexControlConsoleSentMessageSearch?.dispose?.();
  let root, panel, input, results, timer, observer, requestId = 0, active = false;
  const make = (tag, cls, value) => {
    const node = document.createElement(tag); node.className = cls;
    if (value != null) node.textContent = value;
    return node;
  };
  function show(value) {
    if (!results) return;
    results.replaceChildren();
    if (!input?.value.trim()) return;
    if (typeof value === 'string') {
      results.append(make('div', 'px-1 py-1 text-sm text-tertiary', value));
      return;
    }
    results.append(make('div', 'px-1 py-1 text-sm text-tertiary', value.error ||
      (value.items.length ? `${value.items.length} 个会话${value.incomplete ? ' · 结果可能不完整' : ''}` :
        value.incomplete ? '没有匹配结果 · 部分历史暂不可读取' : '没有匹配的已发送消息')));
    for (const item of value.items) {
      const row = make('button', 'sidebar-item w-full px-2 py-1 text-start hover:bg-primary-ghost-hover');
      row.type = 'button'; row.setAttribute('data-sent-message-search-thread-id', item.id);
      row.append(make('div', 'truncate text-sm text-default', item.title));
      row.append(make('div', 'line-clamp-2 text-xs text-tertiary', item.excerpt));
      row.addEventListener('click', () => {
        window.__codexControlConsoleClose?.();
        window.__codexControlConsoleConversationTabs?.openLocal?.({ id: item.id, title: item.title });
        close();
        window.postMessage({ type: 'navigate-to-route', path: '/local/' + item.id }, '*');
      });
      results.append(row);
    }
  }
  function search() {
    clearTimeout(timer);
    const query = input?.value.trim() || '';
    requestId++;
    if (!query) { results?.replaceChildren(); return; }
    show('搜索本机消息中…');
    const id = requestId;
    timer = setTimeout(() => {
      if (typeof window.__codexControlConsoleSearchSentMessages === 'function') {
        window.__codexControlConsoleSearchSentMessages(JSON.stringify({ id, query }));
      } else show('搜索暂时不可用');
    }, 350);
  }
  function close() {
    panel.hidden = true;
    panel.style.display = 'none';
    requestId++;
    clearTimeout(timer);
    root?.querySelector?.('button')?.focus?.();
  }
  function open() {
    panel.hidden = false;
    panel.style.display = 'flex';
    input.focus();
    if (input.value.trim()) search();
  }
  function install() {
    const projectSearch = document.querySelector('[data-codex-control-console-project-search]');
    if (!projectSearch?.parentElement) return;
    if (!root) {
      root = make('div', projectSearch.className, null);
      root.setAttribute('data-codex-control-console-sent-message-search', '');
      const launch = make('button', 'sidebar-item w-full rounded-md px-2 py-1 text-start text-sm text-default hover:bg-primary-ghost-hover', '搜索发送内容');
      launch.type = 'button'; launch.setAttribute('aria-haspopup', 'dialog'); launch.addEventListener('click', open);
      root.append(launch);
      panel = make('div', 'fixed inset-0 z-[9999] flex items-start justify-center bg-black/50 p-6 pt-[10vh]', null);
      panel.hidden = true;
      panel.style.display = 'none';
      panel.setAttribute('data-codex-control-console-sent-message-panel', '');
      panel.addEventListener('click', event => { if (event.target === panel) close(); });
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
      const dialog = make('div', 'w-full max-w-2xl rounded-xl border border-token-border-default bg-primary p-4 shadow-xl', null);
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', '搜索已发送消息');
      const heading = make('div', 'mb-3 flex items-center justify-between text-base text-default', null);
      heading.append(make('span', '', '搜索已发送消息'));
      const dismiss = make('button', 'rounded px-2 py-1 text-sm text-tertiary', '关闭');
      dismiss.type = 'button'; dismiss.addEventListener('click', close); heading.append(dismiss);
      const bar = make('div', 'flex items-center rounded-md border border-token-border-default px-2');
      input = make('input', 'min-w-0 flex-1 bg-transparent py-1 text-base text-default outline-none');
      input.type = 'search'; input.placeholder = '输入你发送过的文字';
      input.setAttribute('aria-label', '搜索本机已发送消息');
      input.addEventListener('input', search);
      input.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
      });
      results = make('div', 'flex flex-col', null);
      results.setAttribute('aria-label', '已发送消息搜索结果');
      results.style.maxHeight = '60vh'; results.style.overflowY = 'auto';
      bar.append(input); dialog.append(heading, bar, make('div', 'my-2 text-xs text-tertiary', '搜索范围：本机未归档会话中你发送的消息'), results);
      panel.append(dialog); document.body.append(panel);
      root.addEventListener('pointerdown', event => event.stopPropagation());
    }
    if (root.parentElement !== projectSearch.parentElement || root.previousSibling !== projectSearch) {
      projectSearch.parentElement.insertBefore(root, projectSearch.nextSibling);
    }
  }
  window.__codexControlConsoleSentMessageSearch = {
    version: VERSION,
    receive(value) { if (value?.id === requestId && input?.value.trim()) show(value); },
    dispose() { active = false; clearTimeout(timer); observer?.disconnect(); root?.remove(); panel?.remove(); }
  };
  active = true;
  install();
  observer = new MutationObserver(() => { if (active) install(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
