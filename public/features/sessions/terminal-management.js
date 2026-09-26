import { terminalConversationRequest } from '../../core/terminal-conversations.js';

export function createTerminalManagement({ state, panel, render, fetchImpl = fetch, documentRef = document }) {
  let busy = false, pendingRender = false, pointerDown = false;
  const editors = new Map();
  const keyOf = value => `${value.deviceId}:${value.id}`;
  const current = entry => (state.terminalConversations || []).find(value => keyOf(value) === keyOf(entry.record)) || entry.record;
  const archives = documentRef.createElement('details'); archives.className = 'session-project-card terminal-archives';
  const heading = documentRef.createElement('summary'), list = documentRef.createElement('div');
  const notice = documentRef.createElement('p'); notice.setAttribute('role', 'status');
  archives.append(heading, list); panel.append(notice, archives);

  function editing() { return pointerDown || [...editors.values()].some(entry => entry.details.contains(documentRef.activeElement)); }
  function flushLater() { setTimeout(() => { if (pendingRender && !editing()) render(); }, 0); }
  documentRef.addEventListener('pointerup', () => { if (pointerDown) setTimeout(() => { pointerDown = false; flushLater(); }, 0); });
  documentRef.addEventListener('pointercancel', () => { pointerDown = false; flushLater(); });

  function deferRender({ force = false } = {}) {
    if (!force && editing()) { pendingRender = true; return true; }
    pendingRender = false; return false;
  }

  function resetDraft(entry, record = current(entry)) {
    entry.record = record; entry.baseRevision = record.revision; entry.baseTitle = record.title;
    entry.field.value = record.title; entry.dirty = false; entry.reset.hidden = true;
  }

  async function update(entry, patch, rename = false) {
    if (busy) return;
    const conversation = current(entry);
    const expectedRevision = rename ? entry.baseRevision : conversation.revision;
    if (rename && expectedRevision !== conversation.revision) {
      notice.textContent = '会话已在其他位置更新，名称草稿已保留。请恢复最新名称后再修改。';
      entry.reset.hidden = false; return;
    }
    busy = true; notice.textContent = '正在保存会话…';
    try {
      const { conversation: next } = await terminalConversationRequest('update', {
        id: conversation.id, expectedRevision, ...patch,
      }, fetchImpl);
      // A later background read may already contain a newer revision. Never replace it with this receipt.
      const latest = current(entry);
      const confirmed = latest.revision > next.revision ? latest : next;
      state.terminalConversations = (state.terminalConversations || []).map(value => keyOf(value) === keyOf(next) ? confirmed : value);
      state.tasks = state.tasks.filter(task => task.provider !== 'terminal' || task.id !== next.id || !confirmed.archived)
        .map(task => task.provider === 'terminal' && task.id === next.id ? { ...task, title: confirmed.title, terminalConversation: confirmed } : task);
      if (!confirmed.archived && !state.tasks.some(task => task.provider === 'terminal' && task.id === next.id)) {
        const device = state.devices.find(value => value.id === confirmed.deviceId);
        state.tasks.push({ id: confirmed.id, provider: 'terminal', title: confirmed.title, cwd: confirmed.cwd, device,
          project: confirmed.cwd.split(/[\\/]/).filter(Boolean).at(-1), updatedAt: confirmed.updatedAt,
          status: 'unknown', boardStatus: 'pending', terminalConversation: confirmed });
      }
      entry.record = confirmed;
      if (rename && entry.field.value === patch.title) resetDraft(entry, confirmed);
      else if (rename && confirmed.title === patch.title) {
        entry.baseRevision = confirmed.revision; entry.baseTitle = confirmed.title;
        entry.dirty = entry.field.value !== entry.baseTitle; entry.reset.hidden = !entry.dirty;
      }
      notice.textContent = confirmed.archived ? '会话已归档，进程保持原状态。' : '会话已保存';
      render({ force: true });
    } catch (error) { notice.textContent = error.message; entry.reset.hidden = !entry.dirty; }
    finally { busy = false; }
  }

  function controls(conversation) {
    const key = keyOf(conversation);
    let entry = editors.get(key);
    if (entry) {
      entry.record = conversation;
      if (!entry.dirty) resetDraft(entry, conversation);
      entry.pin.textContent = conversation.pinned ? '取消置顶' : '置顶';
      entry.archive.textContent = conversation.archived ? '恢复会话' : '归档';
      entry.field.setAttribute('aria-label', `重命名 ${conversation.title}`);
      return entry.details;
    }
    const details = documentRef.createElement('details'); details.className = 'terminal-session-actions';
    const summary = documentRef.createElement('summary'); summary.textContent = '管理'; details.append(summary);
    const field = documentRef.createElement('input'); field.value = conversation.title; field.maxLength = 160;
    field.setAttribute('aria-label', `重命名 ${conversation.title}`); details.append(field);
    entry = { record: conversation, details, field, dirty: false, baseRevision: conversation.revision, baseTitle: conversation.title };
    field.addEventListener('input', () => { entry.dirty = field.value !== entry.baseTitle; entry.reset.hidden = !entry.dirty; });
    details.addEventListener('focusout', flushLater);
    details.addEventListener('pointerdown', () => { pointerDown = true; });
    for (const [name, label, action] of [
      ['save', '保存名称', () => update(entry, { title: field.value }, true)],
      ['reset', '恢复最新名称', () => { resetDraft(entry); notice.textContent = '已恢复最新名称'; }],
      ['pin', conversation.pinned ? '取消置顶' : '置顶', () => update(entry, { pinned: !current(entry).pinned })],
      ['archive', conversation.archived ? '恢复会话' : '归档', () => update(entry, { archived: !current(entry).archived })],
    ]) {
      const button = documentRef.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => void action()); details.append(button); entry[name] = button;
    }
    entry.reset.hidden = true; editors.set(key, entry);
    return details;
  }

  function renderArchives() {
    if (state.terminalError) notice.textContent = state.terminalError;
    const rows = (state.terminalConversations || []).filter(value => value.archived);
    archives.hidden = !rows.length; heading.textContent = `已归档的终端会话 ${rows.length}`;
    list.replaceChildren(...rows.map(value => {
      const row = documentRef.createElement('article'); row.className = 'session-row';
      const title = documentRef.createElement('span'); title.textContent = value.title;
      row.append(title, controls(value)); return row;
    }));
  }
  return { controls, renderArchives, deferRender };
}
