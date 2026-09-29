// Live read-only view of a companion Claude session (docs/specs/2026-09-29-claude-companion-mirror.md).
// Nothing holds the session while it is shown, so Codex can use it; messages sent here run as
// one-shot turns on the server and their replies arrive through the same transcript.
const ROLE = { codex: 'Codex', you: '你', claude: 'Claude', tool: '工具' };
const MAX_NODES = 1500;

export function mirrorStatusText({ turn, occupiedBy, error }) {
  if (error) return error;
  if (turn?.state === 'failed') return turn.error || '这条消息没有执行完成';
  if (turn?.state === 'running') return 'Claude 正在回复…';
  if (turn?.state === 'waiting') return occupiedBy === 'codex' ? '等 Codex 这一轮结束后发送…' : '排队中…';
  if (occupiedBy === 'codex') return 'Codex 正在用这个会话回复…';
  if (occupiedBy) return '会话正在其他 Claude 窗口中运行，此处只读';
  return '';
}

export function createTerminalMirror({ host, request, onChange = () => {}, pollMs = 1500, doc = globalThis.document }) {
  let id = '', cursor = null, timer = null, shown = false, sending = false, generation = 0;
  let meta = { turn: null, occupiedBy: null, error: '' };
  const list = doc.createElement('div'), status = doc.createElement('p');
  list.className = 'terminal-mirror-list'; status.className = 'terminal-mirror-status'; status.setAttribute('role', 'status');
  host.replaceChildren(list, status);
  const post = (operation, body) => request(`/api/terminal-conversations/${operation}`, { method: 'POST', body });
  function entryNode(entry) {
    const node = doc.createElement('article'), role = doc.createElement('span'), text = doc.createElement('div');
    node.className = 'terminal-mirror-entry'; node.dataset.role = entry.role;
    role.className = 'terminal-mirror-role'; role.textContent = ROLE[entry.role] || entry.role;
    text.className = 'terminal-mirror-text'; text.textContent = entry.text;
    node.append(role, text); return node;
  }
  function append(entries, truncated) {
    const atBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 48;
    if (truncated && !list.childElementCount) { const note = doc.createElement('p'); note.className = 'terminal-mirror-note'; note.textContent = '只显示最近的记录'; list.append(note); }
    list.append(...entries.map(entryNode));
    while (list.childElementCount > MAX_NODES) list.firstElementChild.remove();
    if (atBottom || entries.some(entry => entry.role === 'you')) host.scrollTop = host.scrollHeight;
  }
  function renderStatus() {
    status.textContent = mirrorStatusText(meta);
    status.dataset.state = meta.error || meta.turn?.state === 'failed' ? 'error' : meta.turn || meta.occupiedBy ? 'busy' : 'idle';
    onChange();
  }
  function schedule(delay = pollMs) { clearTimeout(timer); if (shown) timer = setTimeout(poll, delay); }
  async function poll() {
    const revision = generation, conversation = id;
    try {
      const result = await post('mirror', { id: conversation, cursor });
      if (revision !== generation) return;
      cursor = result.cursor; meta = { turn: result.turn, occupiedBy: result.occupiedBy, error: '' };
      if (result.entries.length) append(result.entries, result.truncated);
    } catch (failure) {
      if (revision !== generation) return;
      meta = { ...meta, error: failure?.message || '暂时读不到会话记录' };
    }
    renderStatus(); schedule(meta.turn ? 700 : pollMs);
  }
  return {
    show(conversationId) {
      if (conversationId !== id) { ++generation; id = conversationId; cursor = null; list.replaceChildren(); meta = { turn: null, occupiedBy: null, error: '' }; }
      host.classList.remove('hidden');
      if (!shown) { shown = true; schedule(0); }
    },
    hide() { shown = false; clearTimeout(timer); host.classList.add('hidden'); },
    snapshot: () => ({ ...meta, sending, shown, status: mirrorStatusText(meta) }),
    async send(text) {
      if (sending) return;
      sending = true; onChange();
      try { const { turn } = await post('mirror-send', { id, text }); meta = { ...meta, turn, error: '' }; renderStatus(); schedule(300); }
      finally { sending = false; onChange(); }
    },
    dispose() { shown = false; ++generation; clearTimeout(timer); },
  };
}
