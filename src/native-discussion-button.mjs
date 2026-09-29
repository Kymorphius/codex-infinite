// "讨论" beside 新建: start a discussion from a topic (creating both conversations), or pair
// the active Claude / GPT conversation with one of the other kind in the same project, then
// forward either side's latest answer to the other with an optional comment. It only calls the
// host bridge (`window.__cccDiscussions`); no storage formats here. `createThreadStarter` is the
// native composer handoff that sends a first message and returns the new GPT conversation id.
export function installNativeDiscussionButton({ documentRef, root, activeTab, createThreadStarter }) {
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
    node.style.cssText = 'position:fixed;z-index:2147483647;bottom:28px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:8px;background:var(--color-background-primary,#252525);color:var(--color-text);font:13px/20px -apple-system,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28)';
    documentRef.body.append(node); setTimeout(() => node.remove(), 3500);
  };
  const roleOf = (tab) => tab?.kind === 'local' && UUID.test(tab.id || '') ? 'gpt' : tab?.kind === 'terminal' && tab.engine === 'claude' ? 'claude' : '';
  const api = () => window.__cccDiscussions;
  let epoch = 0; // a newer render supersedes answers of an older request

  const close = ({ focus = false } = {}) => {
    epoch++; menu.hidden = true; button.setAttribute('aria-expanded', 'false');
    if (focus) button.focus();
  };
  const update = () => {
    const role = roleOf(activeTab());
    const text = role ? '把 Claude 与 GPT 会话配对，互相转发回答并加上你的点评' : '打开一个 GPT 或 Claude 会话后可配对讨论';
    if (button.disabled !== !role) button.disabled = !role;
    if (!role && !menu.hidden) close();
    if (button.title !== text) { button.title = text; button.setAttribute('aria-label', '讨论：' + text); }
  };

  const clear = () => { while (menu.children.length) menu.children[0].remove(); };
  const heading = (text) => { const node = el('div', 'ccc-native-discuss-heading', text); menu.append(node); return node; };
  const note = (text) => menu.append(el('div', 'ccc-native-discuss-note', text));
  const choice = (title, detail, onClick) => {
    const entry = el('button', 'ccc-native-recent-select');
    entry.type = 'button'; entry.setAttribute('role', 'menuitem');
    const copy = el('span', 'ccc-native-recent-copy');
    copy.append(el('span', 'ccc-native-recent-title', title));
    if (detail) copy.append(el('span', 'ccc-native-recent-detail', detail));
    entry.append(copy);
    entry.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
    menu.append(entry); return entry;
  };
  const failure = (error) => notify(String(error?.message || error || '协作讨论操作失败'));

  async function render() {
    const tab = activeTab(), role = roleOf(tab), mine = ++epoch;
    clear(); if (!role) return close();
    if (!api()) { note('协作讨论功能尚未就绪'); return; }
    note('读取中…');
    try {
      const { discussions } = await api().request('for-conversation', { conversationId: tab.id });
      if (mine !== epoch) return;
      clear();
      if (discussions[0]) return showPaired(discussions[0], role, tab);
      const { candidates, role: candidateRole } = await api().request('candidates', { conversationId: tab.id, role });
      if (mine !== epoch) return;
      clear(); showStart(role, tab);
      heading('或与已有的 ' + NAME[candidateRole] + ' 会话配对');
      if (!candidates.length) return note('这个项目里没有可配对的 ' + NAME[candidateRole] + ' 会话。');
      for (const item of candidates) {
        choice(item.title || '未命名会话', '配对后可互相转发回答', async () => {
          close();
          try {
            await api().request('create', role === 'gpt' ? { claudeConversationId: item.id, gptConversationId: tab.id } : { claudeConversationId: tab.id, gptConversationId: item.id });
            notify('已配对：' + (item.title || NAME[candidateRole]));
          } catch (error) { failure(error); }
        });
      }
    } catch (error) { if (mine === epoch) { clear(); note(String(error?.message || '读取失败')); } }
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
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  let starting = false;

  // Both conversations are created here: GPT first (the risky native step, so a failure leaves
  // nothing behind), then Claude; the host pairs them and hands Claude its opening message.
  async function startNew(first, topic, role, tab) {
    if (starting) return;
    const text = String(topic || '').trim();
    if (!text) return notify('请先写下议题');
    const project = projectOf(tab, role), directories = project?.sourceDirectories;
    if (!project) return notify('找不到当前会话所属项目，请先在项目中展开它');
    if (!Array.isArray(directories) || directories.length !== 1) return notify('新建讨论需要项目只有一个目录；这个项目有多个目录或找不到目录');
    const terminals = window.__cccTerminalConversations;
    if (!window.__cccProjectSearchActions?.create || !terminals?.createRecord || typeof createThreadStarter !== 'function') return notify('原生新建入口尚未就绪');
    starting = true; close();
    let gptId = null;
    try {
      const prepared = await api().request('prepare', { first, topic: text });
      notify('正在创建讨论会话…');
      if (!(await window.__cccProjectSearchActions.create(project))) return;
      const starter = createThreadStarter();
      let failure = null;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        try { starter.preflight(); failure = null; break; } catch (error) { failure = error; if (/已有内容/.test(error.message || '')) break; await pause(100); }
      }
      if (failure) throw failure;
      gptId = await starter(prepared.gptText);
      const claude = await terminals.createRecord(project, directories[0], 'claude', { open: false });
      const result = await api().request('begin', { first, topic: text, claudeConversationId: claude.id, gptConversationId: gptId });
      if (first === 'claude') window.__codexControlConsoleOpenTerminalConversation?.(claude);
      notify(result.deliveryError ? '已配对，但 Claude 未收到开场消息：' + result.deliveryError + '。请手动把议题发给它' : '已新建讨论：' + NAME[first] + ' 先答，答完可用「讨论」转发给对方');
    } catch (error) {
      notify((gptId ? '已创建 GPT 会话，但后续步骤失败：' : '新建讨论失败：') + String(error?.message || error) + (gptId ? '。可用「与已有会话配对」补上' : ''));
    } finally { starting = false; }
  }

  function showStart(role, tab) {
    heading('新建讨论');
    const topic = documentRef.createElement('textarea');
    topic.className = 'ccc-native-discuss-comment';
    topic.placeholder = '写下议题：会发给先答的一方，另一方会被告知议题并等待';
    topic.rows = 3; topic.maxLength = 8000;
    topic.setAttribute('aria-label', '议题');
    const actions = el('div', 'ccc-native-discuss-actions');
    for (const first of ['gpt', 'claude']) {
      const start = el('button', 'ccc-native-discuss-primary', NAME[first] + ' 先答'); start.type = 'button';
      start.dataset.discussStart = first;
      start.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void startNew(first, topic.value, role, tab); });
      actions.append(start);
    }
    menu.append(topic, actions);
  }

  function showPaired(discussion, role, tab) {
    const peer = other(role);
    heading('已与 ' + (discussion.titles?.[peer] || NAME[peer]) + ' 配对 · 已转发 ' + discussion.round + ' 次');
    choice('把这边的回答转给 ' + NAME[peer] + '…', '可先写点评，一起发送', () => showForward(discussion, role, role, tab));
    choice('把 ' + NAME[peer] + ' 的回答转给这边…', '可先写点评，一起发送', () => showForward(discussion, peer, role, tab));
    choice('解除配对', '之后不再转发，已发送的消息保留', async () => {
      close();
      try { await api().request('stop', { id: discussion.id }); notify('已解除配对'); } catch (error) { failure(error); }
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
        close(); notify('已把 ' + NAME[from] + ' 的回答转给 ' + NAME[to]);
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

export const NATIVE_DISCUSSION_STYLE = '.ccc-native-discuss-menu{width:340px;max-width:calc(100vw - 24px);padding:6px}.ccc-native-discuss-heading{padding:6px 10px;font-weight:600;font-size:12px;opacity:.85}.ccc-native-discuss-note{padding:6px 10px;font-size:12px;opacity:.7;white-space:normal}.ccc-native-discuss-preview{margin:2px 10px 6px;padding:8px;max-height:150px;overflow:auto;border-radius:8px;background:var(--color-background-secondary,rgba(127,127,127,.12));font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}.ccc-native-discuss-comment{box-sizing:border-box;display:block;width:calc(100% - 20px);margin:4px 10px;padding:8px;resize:vertical;border-radius:8px;border:1px solid var(--color-border,rgba(127,127,127,.35));background:transparent;color:inherit;font:12px/18px inherit}.ccc-native-discuss-actions{display:flex;justify-content:flex-end;gap:8px;padding:4px 10px 6px}.ccc-native-discuss-actions button{padding:5px 12px;border-radius:7px;border:1px solid var(--color-border,rgba(127,127,127,.35));background:transparent;color:inherit;font-size:12px;cursor:pointer}.ccc-native-discuss-actions .ccc-native-discuss-primary{background:var(--color-accent,#2f6fed);border-color:transparent;color:#fff}.ccc-native-discuss-actions button:disabled{opacity:.4;cursor:default}';
