// "讨论" beside 新建: pair the active Claude / GPT conversation with an existing one of the other
// kind (searchable list) or discuss with a newly created one, start a discussion from the native
// new-chat page, then forward either side's latest answer to the other with an optional comment.
// It only calls the host bridge (`window.__cccDiscussions`); no storage formats here.
// `createStarter` builds the 新建讨论 flows (native-discussion-start.mjs) around
// `createThreadStarter`, the native composer handoff that returns a new GPT conversation id.
export function installNativeDiscussionButton({ documentRef, root, activeTab, createThreadStarter, createStarter }) {
  const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const NAME = { claude: 'Claude', gpt: 'GPT' };
  const other = (role) => role === 'claude' ? 'gpt' : 'claude';
  const svg = (name) => documentRef.createElementNS('http://www.w3.org/2000/svg', name);
  const el = (tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const host = el('div', 'ccc-native-recent ccc-native-discuss');
  const button = el('button', 'ccc-native-recent-trigger');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  const icon = svg('svg');
  for (const [key, value] of [['class', 'ccc-native-recent-icon'], ['aria-hidden', 'true'], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) icon.setAttribute(key, value);
  const path = svg('path');
  path.setAttribute('d', 'M4 5h11v8H9l-3 3v-3H4zM18 9h2v8h-2v3l-3-3h-5v-2');
  icon.append(path);
  button.append(icon, el('span', '', '讨论'));
  const menu = el('div', 'ccc-native-recent-menu ccc-native-discuss-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Claude 与 GPT 协作讨论');
  menu.hidden = true;
  host.append(button, menu);
  root.append(host);

  const notify = (message) => {
    const node = el('div', '', message);
    node.setAttribute('role', 'status');
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--color-surface-elevated,var(--color-surface,#252525));color:var(--color-text);font:13px/20px -apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28)';
    documentRef.body.append(node); setTimeout(() => node.remove(), 3500);
  };
  const roleOf = (tab) => tab?.kind === 'local' && UUID.test(tab.id || '') ? 'gpt' : tab?.kind === 'terminal' && tab.engine === 'claude' ? 'claude' : '';
  const api = () => window.__cccDiscussions;
  // The native 新建聊天 page: a composer with no conversation mounted. Whatever tab the console
  // remembers, a terminal or console view is not it.
  const newChatEditor = () => {
    const tab = activeTab();
    if (tab && ['terminal', 'console', 'chatgpt', 'remote'].includes(tab.kind)) return null;
    const editor = documentRef.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    return editor && !documentRef.querySelector('[data-above-composer-conversation-id]') ? editor : null;
  };
  const modeOf = () => newChatEditor() ? 'newchat' : roleOf(activeTab());
  let epoch = 0; // a newer render supersedes answers of an older request

  const close = ({ focus = false } = {}) => {
    epoch++; menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  };
  const update = () => {
    const mode = modeOf();
    const text = mode === 'newchat' ? '把输入框里的内容作为议题，新建 GPT 与 Claude 的协作讨论'
      : mode ? '把 Claude 与 GPT 会话配对，互相转发回答并加上你的点评' : '打开一个 GPT 或 Claude 会话，或在新建聊天页写下议题后可讨论';
    if (button.disabled !== !mode) button.disabled = !mode;
    if (!mode && !menu.hidden) close();
    if (button.title !== text) { button.title = text; button.setAttribute('aria-label', '讨论：' + text); }
  };

  const clear = () => { while (menu.children.length) menu.children[0].remove(); };
  const heading = (text) => { const node = el('div', 'ccc-native-discuss-heading', text); node.title = text; menu.append(node); return node; };
  const note = (text) => menu.append(el('div', 'ccc-native-discuss-note', text));
  const choice = (title, detail, onClick, parent = menu) => {
    const entry = el('button', 'ccc-native-recent-select');
    entry.type = 'button'; entry.setAttribute('role', 'menuitem');
    const copy = el('span', 'ccc-native-recent-copy');
    copy.append(el('span', 'ccc-native-recent-title', title));
    if (detail) copy.append(el('span', 'ccc-native-recent-detail', detail));
    entry.append(copy);
    entry.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
    parent.append(entry); return entry;
  };
  const failure = (error) => notify(String(error?.message || error || '协作讨论操作失败'));

  async function render() {
    const tab = activeTab(), mode = modeOf(), role = mode === 'newchat' ? '' : mode, mine = ++epoch;
    clear(); if (!mode) return close();
    if (!api()) { note('协作讨论功能尚未就绪'); return; }
    if (mode === 'newchat') return showNewChat();
    note('读取中…');
    try {
      const { discussions } = await api().request('for-conversation', { conversationId: tab.id });
      if (mine !== epoch) return;
      clear();
      if (discussions[0]) return showPaired(discussions[0], role, tab);
      const { candidates, role: candidateRole } = await api().request('candidates', { conversationId: tab.id, role });
      if (mine !== epoch) return;
      clear(); showCandidates(role, tab, candidates, candidateRole); showStart(role, tab);
    } catch (error) { if (mine === epoch) { clear(); note(String(error?.message || '读取失败')); } }
  }

  const when = (value) => {
    const date = new Date(value || '');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  // Existing conversations of the other kind in this project, newest first, filtered by a search box.
  function showCandidates(role, tab, candidates, candidateRole) {
    heading('与已有的 ' + NAME[candidateRole] + ' 会话配对' + (candidates.length ? '（共 ' + candidates.length + ' 个）' : ''));
    if (!candidates.length) return note('这个项目里没有可配对的 ' + NAME[candidateRole] + ' 会话。');
    const filter = documentRef.createElement('input');
    filter.type = 'search'; filter.className = 'ccc-native-discuss-search'; filter.placeholder = '搜索会话标题';
    filter.setAttribute('aria-label', '搜索可配对的会话');
    const list = el('div', 'ccc-native-discuss-list');
    const draw = () => {
      while (list.children.length) list.children[0].remove();
      const query = filter.value.trim().toLowerCase();
      const shown = candidates.filter((item) => !query || String(item.title || '').toLowerCase().includes(query));
      if (!shown.length) list.append(el('div', 'ccc-native-discuss-note', '没有匹配的会话'));
      for (const item of shown) {
        choice(item.title || '未命名会话', when(item.updatedAt) || '配对后可互相转发回答', async () => {
          close();
          try {
            await api().request('create', role === 'gpt' ? { claudeConversationId: item.id, gptConversationId: tab.id } : { claudeConversationId: tab.id, gptConversationId: item.id });
            notify('已配对：' + (item.title || NAME[candidateRole])); window.__cccTerminalConversations?.refresh?.();
          } catch (error) { failure(error); }
        }, list);
      }
    };
    filter.addEventListener('input', draw);
    menu.append(filter, list); draw();
  }

  // Project of the active conversation, as the search catalog knows it (same lookup as 新建).
  const search = () => window.__codexControlConsoleProjectSearch;
  const projectOf = (tab, role) => {
    if (role === 'claude') {
      const record = window.__cccTerminalConversations?.records?.().find((item) => item.id === tab.id);
      return record ? search()?.projectOfDirectory?.(record.cwd) : null;
    }
    const found = search()?.projectOfTask?.(tab.id);
    if (found) return found;
    const row = documentRef.querySelector('[data-app-action-sidebar-thread-id="local:' + tab.id + '"],[data-app-action-sidebar-thread-id="' + tab.id + '"]');
    const listId = row?.closest?.('[data-app-action-sidebar-project-list-id]')?.getAttribute('data-app-action-sidebar-project-list-id') || '';
    return listId ? search()?.projectOfTask?.(tab.id) || { id: listId.replace(/^local-/, '') } : null;
  };
  // Project of the native new-chat page: the sidebar row marked current, confirmed by the
  // composer's project picker ("更改项目：<name>") so a stale highlight is never trusted.
  const newChatProject = () => {
    const picker = Array.from(documentRef.querySelectorAll('button')).find((node) => /^更改项目[:：]/.test(node.getAttribute('aria-label') || ''));
    const name = (picker?.getAttribute('aria-label') || '').replace(/^更改项目[:：]\s*/, '');
    const row = documentRef.querySelector('[data-app-action-sidebar-project-id][aria-current="page"]');
    if (!name || !row || row.getAttribute('data-app-action-sidebar-project-label') !== name) return null;
    return search()?.projectOfKey?.(row.getAttribute('data-app-action-sidebar-project-id')) || null;
  };
  const composerText = (editor) => String(editor?.innerText || editor?.textContent || '').trim();
  const startNew = typeof createStarter === 'function' ? createStarter({ documentRef, api, notify, close, createThreadStarter }) : () => notify('原生新建入口尚未就绪');

  const startButtons = (onStart, hint = () => '') => {
    const actions = el('div', 'ccc-native-discuss-actions');
    for (const first of ['gpt', 'claude']) {
      const start = el('button', 'ccc-native-discuss-primary', NAME[first] + ' 先答'); start.type = 'button';
      start.dataset.discussStart = first; start.title = hint(first);
      start.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onStart(first); });
      actions.append(start);
    }
    return actions;
  };

  // New-chat page: the composer's content is the topic; choose who answers first.
  function showNewChat() {
    heading('新建讨论');
    const editor = newChatEditor(), text = composerText(editor);
    note(text ? '议题（输入框里的内容）：' + (text.length > 80 ? text.slice(0, 80) + '…' : text) : '先在输入框里写下议题，再选择谁先答。');
    menu.append(startButtons((first) => { const current = newChatEditor(); void startNew({ first, topic: composerText(current), project: newChatProject(), editor: current }); }));
  }

  // From an existing conversation: this conversation is one side, a new one of the other kind is
  // the other; the topic goes to whoever answers first.
  function showStart(role, tab) {
    heading('与本会话讨论：' + (tab.title || '当前会话'));
    note('会新建一个 ' + NAME[other(role)] + ' 会话作为对方，议题发给先答的一方。');
    const topic = documentRef.createElement('textarea');
    topic.className = 'ccc-native-discuss-comment';
    topic.placeholder = '写下议题：会发给先答的一方，另一方会被告知议题并等待';
    topic.rows = 2; topic.maxLength = 8000;
    topic.setAttribute('aria-label', '议题');
    menu.append(topic, startButtons((first) => void startNew({ first, topic: topic.value, project: projectOf(tab, role), current: { role, tab } }),
      (first) => first === role ? '本会话先答，新建的 ' + NAME[other(role)] + ' 等它' : '新建的 ' + NAME[first] + ' 会话先答，本会话等它'));
  }

  function showPaired(discussion, role, tab) {
    const peer = other(role);
    heading('已与 ' + (discussion.titles?.[peer] || NAME[peer]) + ' 配对 · 已转发 ' + discussion.round + ' 次');
    choice('把这边的回答转给 ' + NAME[peer] + '…', '可先写点评，一起发送', () => showForward(discussion, role, role, tab));
    choice('把 ' + NAME[peer] + ' 的回答转给这边…', '可先写点评，一起发送', () => showForward(discussion, peer, role, tab));
    choice('解除配对', '之后不再转发，已发送的消息保留', async () => {
      close();
      try { await api().request('stop', { id: discussion.id }); notify('已解除配对'); window.__cccTerminalConversations?.refresh?.(); } catch (error) { failure(error); }
    });
  }

  async function showForward(discussion, from, role, tab) {
    const to = other(from), mine = ++epoch;
    clear(); heading('把 ' + NAME[from] + ' 的最新回答转给 ' + NAME[to]);
    note('读取回答…');
    let latest;
    try { latest = await api().request('latest', { id: discussion.id, from }); } catch (error) { if (mine === epoch) { clear(); note(String(error?.message || '读取失败')); } return; }
    if (mine !== epoch) return;
    clear(); heading('把 ' + NAME[from] + ' 的最新回答转给 ' + NAME[to]);
    const answer = latest.answer;
    const preview = el('div', 'ccc-native-discuss-preview', answer ? (answer.text.length > 600 ? answer.text.slice(0, 600) + '…' : answer.text) : '');
    if (answer) menu.append(preview);
    if (!answer) note(NAME[from] + ' 还没有可转发的回答。');
    else if (answer.forwarded) note('这条回答已经转发过了；等对方或它给出新回答后再转发。');
    const pending = latest.pendingComments || [];
    if (pending.length) note('另有 ' + pending.length + ' 条已记下的点评会一起发送。');
    const comment = documentRef.createElement('textarea');
    comment.className = 'ccc-native-discuss-comment';
    comment.placeholder = '你的点评（可选），会附在回答后一起发给 ' + NAME[to];
    comment.rows = 3; comment.maxLength = 4000;
    comment.setAttribute('aria-label', '点评');
    const actions = el('div', 'ccc-native-discuss-actions');
    const back = el('button', 'ccc-native-discuss-secondary', '返回'); back.type = 'button';
    const send = el('button', 'ccc-native-discuss-primary', '转发'); send.type = 'button';
    send.disabled = !answer || answer.forwarded === true;
    const submit = async () => {
      if (send.disabled) return;
      send.disabled = true;
      try {
        await api().request('forward', { id: discussion.id, from, comment: comment.value });
        close(); notify('已把 ' + NAME[from] + ' 的回答转给 ' + NAME[to]); window.__cccTerminalConversations?.refresh?.();
      } catch (error) { failure(error); send.disabled = false; }
    };
    back.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); showPaired(discussion, role, tab); });
    send.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); submit(); });
    comment.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } });
    actions.append(back, send);
    menu.append(comment, actions);
    comment.focus?.({ preventScroll: true });
  }

  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation();
    if (button.disabled) return;
    if (!menu.hidden) return close();
    menu.hidden = false; button.setAttribute('aria-expanded', 'true');
    void render();
  });
  const outside = (event) => { if (!menu.hidden && !host.contains(event.target)) close(); };
  const keyboard = (event) => { if (!menu.hidden && event.key === 'Escape') { event.preventDefault(); close({ focus: true }); } };
  documentRef.addEventListener('pointerdown', outside, true);
  documentRef.addEventListener('keydown', keyboard, true);
  update();
  return {
    update,
    close,
    destroy() {
      documentRef.removeEventListener('pointerdown', outside, true);
      documentRef.removeEventListener('keydown', keyboard, true);
      host.remove();
    }
  };
}

export const NATIVE_DISCUSSION_STYLE = '.ccc-native-discuss-menu{width:min(360px,calc(100vw - 32px));max-width:none;padding:6px;display:flex;flex-direction:column;overflow:hidden}.ccc-native-discuss-menu[hidden]{display:none}.ccc-native-discuss-menu>*{flex:none}.ccc-native-discuss-search,.ccc-native-discuss-comment{box-sizing:border-box;display:block;width:calc(100% - 16px);margin:2px 8px 6px;padding:7px 8px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);background:color-mix(in srgb,currentColor 5%,transparent);color:inherit;font:400 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.ccc-native-discuss-search{-webkit-appearance:none;appearance:none}.ccc-native-discuss-comment{resize:vertical;min-height:60px;max-height:min(160px,28vh)}.ccc-native-discuss-search:focus,.ccc-native-discuss-comment:focus{outline:none;border-color:color-mix(in srgb,currentColor 40%,transparent)}.ccc-native-discuss-search::placeholder,.ccc-native-discuss-comment::placeholder{color:color-mix(in srgb,currentColor 45%,transparent);opacity:1}.ccc-native-discuss-menu>.ccc-native-discuss-list{flex:1 1 auto;min-height:96px;overflow:auto;margin:0;overscroll-behavior:contain;scrollbar-width:thin}.ccc-native-discuss-heading{padding:6px 8px 4px;font:600 11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.62;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ccc-native-discuss-list+.ccc-native-discuss-heading,.ccc-native-discuss-actions+.ccc-native-discuss-heading{margin-top:6px;padding-top:10px;border-top:1px solid color-mix(in srgb,currentColor 12%,transparent)}.ccc-native-discuss-note{padding:2px 8px 6px;font:400 11px/15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:.58;white-space:normal;overflow-wrap:anywhere}.ccc-native-discuss-menu>.ccc-native-discuss-preview{flex:1 1 auto;min-height:48px;margin:2px 8px 6px;padding:8px;overflow:auto;overscroll-behavior:contain;border-radius:8px;background:color-mix(in srgb,currentColor 7%,transparent);font:400 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:pre-wrap;overflow-wrap:anywhere}.ccc-native-discuss-actions{display:flex;gap:6px;padding:2px 8px 4px}.ccc-native-discuss-actions button{flex:1 1 0;height:28px;padding:0 10px;border-radius:8px;border:1px solid color-mix(in srgb,currentColor 15%,transparent);background:transparent;color:inherit;font:500 12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .16s ease}.ccc-native-discuss-actions button:hover:not(:disabled){background:color-mix(in srgb,currentColor 9%,transparent)}.ccc-native-discuss-actions button:focus-visible{outline:2px solid color-mix(in srgb,currentColor 65%,transparent);outline-offset:-2px}.ccc-native-discuss-actions .ccc-native-discuss-primary{background:color-mix(in srgb,#6d8cff 14%,transparent);border-color:color-mix(in srgb,#6d8cff 35%,transparent);color:inherit}.ccc-native-discuss-actions .ccc-native-discuss-primary:hover:not(:disabled){background:color-mix(in srgb,#6d8cff 24%,transparent)}.ccc-native-discuss-actions button:disabled{opacity:.4;cursor:default}';
