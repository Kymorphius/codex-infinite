import { actionIssue, catalogRows, validateCatalog } from '../task-center/model.js';

export function createTerminalTasks({ request, getConversation, getDraft, setDraft, onChange = () => {}, uuid = () => crypto.randomUUID(), storage }) {
  let catalog = null, loading = false, pending = false, error = '', notice = '', mode = 'assigned', opened = false;
  const saves = new Map();
  const saveKey = conversation => `terminal-task-save.v1:${conversation.deviceId}:${conversation.id}`;
  function persistSave(conversation, saved) {
    try { if (saved) storage?.setItem(saveKey(conversation), JSON.stringify(saved)); else storage?.removeItem(saveKey(conversation)); } catch { /* The current view still retains its receipt. */ }
  }
  function previousSave(conversation) {
    if (saves.has(conversation.id)) return saves.get(conversation.id);
    try {
      const value = JSON.parse(storage?.getItem(saveKey(conversation)) || 'null');
      if (value && typeof value.id === 'string' && typeof value.requestId === 'string' && typeof value.text === 'string' && value.text.length <= 5000) return value;
    } catch { /* A missing or malformed optional receipt is ignored. */ }
    return null;
  }
  const localRows = () => catalogRows(catalog).filter(item => item.source === 'checklist');
  const sameTarget = item => item.assignedProvider === 'terminal' && item.assignedDeviceId === getConversation()?.deviceId && item.assignedThreadId === getConversation()?.id;
  const available = item => !item.done && !item.assignedThreadId && !item.deliveryReservation && item.executionState !== 'delivered';
  function snapshot() {
    const rows = localRows();
    const assigned = rows.filter(item => sameTarget(item) && !item.done);
    const inbox = rows.filter(available);
    return { loading, pending, error, notice, mode, opened, assigned, inbox, rows: mode === 'inbox' ? inbox : assigned };
  }
  const publish = () => onChange(snapshot());
  async function load() {
    if (loading) return;
    loading = true; publish();
    try { catalog = validateCatalog(await request('/api/task-center?refresh=1')); error = ''; }
    catch (failure) { error = failure.message || '无法读取共享待办，请刷新重试。'; }
    finally { loading = false; publish(); }
  }
  function checkItem(item, type) {
    const issue = actionIssue(item, type);
    if (issue) throw Error(issue);
    if (type === 'assign' && hasAttachments(item)) throw Error('这项任务含有图片，请在支持图片的会话中领取；任务保持不变。');
    if (type === 'assign' && item.ownerDeviceId !== catalog?.localDeviceId) throw Error('终端会话目前只支持领取本机来源的任务，远端任务保持不变。');
  }
  async function action(type, item, extra = {}, requestId = uuid()) {
    if (item.key) checkItem(item, type);
    const body = { type, ownerDeviceId: item.ownerDeviceId, id: item.id, requestId,
      ...(item.scopeId ? { scopeId: item.scopeId } : {}), ...(item.revision ? { expectedRevision: item.revision } : {}), ...extra };
    const result = await request('/api/task-center/actions', { method: 'POST', body });
    if (result?.applied !== true || result.requestId !== requestId) throw Error('来源设备未确认这次操作，草稿已保留。请刷新核对。');
    return result.item;
  }
  const target = conversation => ({ assignedProvider: 'terminal', assignedDeviceId: conversation.deviceId, assignedThreadId: conversation.id });
  async function save() {
    if (pending || !getConversation()) return false;
    const conversation = getConversation(), text = getDraft();
    if (!text.trim() || text.length > 5000) { error = text.length > 5000 ? '待办内容最多 5000 字，草稿已保留。' : '请先输入待办内容。'; publish(); return false; }
    pending = true; error = ''; notice = ''; publish();
    let saved = previousSave(conversation);
    try {
      if (!catalog) await load();
      if (!catalog) throw Error('尚未读到共享待办，请刷新后再保存。');
      if (!saved) {
        saved = { id: uuid(), requestId: uuid(), text, ownerDeviceId: catalog.localDeviceId, item: null };
        saves.set(conversation.id, saved);
        persistSave(conversation, saved);
      }
      // Read-back recovers an acknowledged write whose response was lost.
      saved.item = localRows().find(item => item.id === saved.id && item.ownerDeviceId === saved.ownerDeviceId) || saved.item;
      if (!saved.item) saved.item = await action('create', saved, { text: saved.text }, saved.requestId);
      persistSave(conversation, saved);
      if (!saved.item?.revision) throw Error('待办已保存，但版本未确认。请刷新后重试；不会重复创建。');
      if (!sameAssignment(saved.item, conversation)) {
        saved.item = await action('assign', { ...saved.item, connected: true, source: 'checklist' }, target(conversation));
      }
      saves.delete(conversation.id);
      persistSave(conversation, null);
      if (getConversation()?.id === conversation.id && getDraft() === saved.text) setDraft('');
      notice = text === saved.text ? '已存入当前会话待办，等待你手动发送。' : '上次待办已保存完成，新草稿仍在输入框，可继续存待办。';
      await load(); return true;
    } catch (failure) { error = failure.message || '待办尚未保存完成，草稿已保留。'; await loadPreservingError(); return false; }
    finally { pending = false; publish(); }
  }
  async function loadPreservingError() { const message = error; await load(); error = message; }
  async function mutate(type, key) {
    if (pending) return false;
    const item = localRows().find(row => row.key === key), conversation = getConversation();
    if (!item || !conversation) return false;
    pending = true; error = ''; notice = ''; publish();
    try {
      if (type === 'assign' && !available(item)) throw Error('这项任务已被领取，请刷新后再选择。');
      if (type !== 'assign' && !sameTarget(item)) throw Error('这项任务不属于当前会话。');
      await action(type, item, type === 'assign' ? target(conversation) : {});
      notice = ({ assign: '已领取到会话待办，选择填入后可手动发送。', complete: '已标记完成。', return: '已退回共享任务池。' })[type];
      if (type === 'assign') mode = 'assigned';
      await load(); return true;
    } catch (failure) { error = failure.message || '任务操作未完成，请刷新核对。'; await loadPreservingError(); return false; }
    finally { pending = false; publish(); }
  }
  function insert(key) {
    const item = localRows().find(row => row.key === key);
    if (!item || !sameTarget(item)) return false;
    if (getDraft()) { error = '输入框已有草稿，请先发送或保存；原草稿未被覆盖。'; publish(); return false; }
    if (hasAttachments(item)) { error = '这项任务含图片，不能填入终端。'; publish(); return false; }
    setDraft(item.text); notice = '已填入输入框，尚未发送。'; error = ''; opened = false; publish(); return true;
  }
  return { load, snapshot, save, mutate, insert,
    select() { error = ''; notice = ''; opened = false; publish(); },
    open(value = 'assigned') { mode = value; opened = true; publish(); void load(); },
    close() { opened = false; publish(); } };
}

function sameAssignment(item, conversation) {
  return item.assignedProvider === 'terminal' && item.assignedDeviceId === conversation.deviceId && item.assignedThreadId === conversation.id;
}

function hasAttachments(item) {
  return item.attachmentCount > 0 || item.images?.length || item.attachments?.length || item.input?.some(part => part.type !== 'text');
}

export function renderTerminalTasks(panel, state, documentRef = document) {
  panel.classList.toggle('hidden', !state.opened);
  const message = panel.querySelector('[data-terminal-task-message]');
  message.textContent = state.error || state.notice || (state.loading ? '正在读取共享任务…' : '领取与填入都不会自动发送。');
  const list = panel.querySelector('[data-terminal-task-list]');
  list.replaceChildren(...state.rows.map(item => {
    const row = documentRef.createElement('article'); row.className = 'terminal-task-row';
    const text = documentRef.createElement('p'); text.textContent = item.text;
    const actions = documentRef.createElement('div');
    const choices = state.mode === 'inbox' ? [['assign', '领取']] : [['insert', '填入'], ['complete', '完成'], ['return', '退回']];
    for (const [action, label] of choices) {
      const button = documentRef.createElement('button'); button.type = 'button'; button.textContent = label;
      button.dataset.terminalTaskAction = action; button.dataset.taskKey = item.key;
      button.disabled = state.pending || !item.connected || Boolean(item.deliveryReservation);
      actions.append(button);
    }
    row.append(text, actions); return row;
  }));
  if (!state.rows.length) { const empty = documentRef.createElement('p'); empty.textContent = state.mode === 'inbox' ? '暂无可领取的任务。' : '当前会话暂无待办。'; list.append(empty); }
}
