import { actionIssue, assignmentTargets, catalogRows, filterRows, PAGE_SIZE, validateCatalog } from './model.js';

export function createTaskCenterController({ request, tasks = () => [], render = () => {}, randomUUID = () => crypto.randomUUID() } = {}) {
  const state = { catalog: null, stale: false, loading: false, pending: false, error: '', notice: '', editor: null,
    filter: { device: '', query: '', status: '' }, limit: PAGE_SIZE };
  let inFlight = null, generation = 0, lastReadAt = 0;
  function projected() {
    const rows = catalogRows(state.catalog), matches = filterRows(rows, state.filter);
    return { ...state, rows, matches, visible: matches.slice(0, state.limit), targets: assignmentTargets(tasks(), state.catalog) };
  }
  const publish = () => render(projected());
  async function load({ explicit = false } = {}) {
    if (state.pending) return false;
    if (inFlight) return inFlight;
    const interval = state.catalog?.devices.some(entry => entry.status === 'loading') ? 2000 : 10000;
    if (!explicit && state.catalog && Date.now() - lastReadAt < interval) return true;
    const current = generation;
    state.loading = true;
    if (explicit || !state.catalog) publish();
    lastReadAt = Date.now();
    inFlight = (async () => {
      try {
        const data = validateCatalog(await request(`/api/task-center${explicit ? '?refresh=1' : ''}`));
        if (current !== generation) return false;
        state.catalog = data;
        if (explicit || !state.stale) { state.stale = false; state.error = ''; }
        return true;
      } catch (error) {
        if (current === generation) { state.stale = true; state.error = `${error.message || '读取任务失败'} 已保留上次列表，请刷新后重试。`; }
        return false;
      } finally { state.loading = false; inFlight = null; publish(); }
    })();
    return inFlight;
  }
  function edit(type, key = '') {
    if (state.pending) return false;
    const item = projected().rows.find(row => row.key === key);
    const issue = type === 'create' ? (state.stale ? '请刷新列表后再添加任务。' : '') : actionIssue(item, type, state.stale);
    if (issue) { if (!state.stale || !state.error) state.error = issue; publish(); return false; }
    const ownerDeviceId = item?.ownerDeviceId || state.catalog?.localDeviceId;
    state.editor = { type, key, ownerDeviceId, text: item?.text || '', target: '', revision: item?.revision, id: type === 'create' ? randomUUID() : item.id };
    state.notice = ''; publish(); return true;
  }
  function draft(values) { if (state.editor && !state.pending) Object.assign(state.editor, values); }
  function cancel() { if (!state.pending) { state.editor = null; publish(); } }
  function filter(values) { Object.assign(state.filter, values); state.limit = PAGE_SIZE; publish(); }
  async function submit() {
    if (state.pending || !state.editor) return false;
    const editor = { ...state.editor }, view = projected(), item = view.rows.find(row => row.key === editor.key);
    let issue = editor.type === 'create' ? '' : actionIssue(item, editor.type, state.stale);
    const owner = state.catalog?.devices.find(entry => entry.device.id === editor.ownerDeviceId);
    if (!owner || owner.status !== 'connected' || state.stale) issue ||= '来源设备暂不可用，请刷新后重试。';
    if (item && item.revision !== editor.revision) issue ||= '任务已在另一处修改，请关闭编辑并刷新后重试；当前草稿已保留。';
    const target = view.targets.find(task => task.key === editor.target);
    if (editor.type === 'assign' && target?.provider === 'terminal') {
      if (item?.attachmentCount || item?.input?.some(part => part.type !== 'text')) issue ||= '终端会话暂不支持图片任务，原任务和附件已保留。';
      if (owner && owner.device.id !== state.catalog.localDeviceId) issue ||= '终端会话目前只支持领取本机来源的任务，远端任务保持不变。';
    }
    if (editor.type === 'assign' && !target) issue ||= '请选择当前在线设备上的会话。';
    if (['edit', 'create'].includes(editor.type) && !editor.text.trim()) issue ||= '请填写任务内容。';
    if (['edit', 'create'].includes(editor.type) && editor.text.length > 5000) issue ||= '任务内容最多 5000 字。';
    if (issue) { if (!state.stale || !state.error) state.error = issue; publish(); return false; }
    const body = { type: editor.type, ownerDeviceId: editor.ownerDeviceId, id: editor.id, requestId: randomUUID(),
      ...(item ? { scopeId: item.scopeId, expectedRevision: editor.revision } : {}),
      ...(['edit', 'create'].includes(editor.type) ? { text: editor.text } : {}),
      ...(target ? { assignedProvider: target.provider ?? 'codex', assignedDeviceId: target.device.id, assignedThreadId: target.id } : {}) };
    generation++; state.pending = true; state.error = ''; publish();
    try {
      const result = await request('/api/task-center/actions', { method: 'POST', body });
      if (result?.status && !['ok', 'applied', 'accepted'].includes(result.status)) throw Error(result.message || '任务操作未确认');
      if (result?.applied !== true || result.requestId !== body.requestId) throw Error('来源设备尚未确认这次操作。');
      state.editor = null;
      state.notice = editor.type === 'assign' ? `已指派到 ${target.deviceName} 的会话待办，保持暂停。` : '已保存。';
      state.pending = false;
      // A read started before the write must not replace the updated owner version.
      if (inFlight) await inFlight;
      await load({ explicit: true }); return true;
    } catch (error) {
      state.stale = true; state.error = `${error.message || '操作结果未确认'} 请刷新核对后再操作；不会自动重复提交。`; return false;
    } finally { state.pending = false; publish(); }
  }
  return { load, edit, draft, cancel, filter, submit, getState: projected, render: publish,
    more() { state.limit += PAGE_SIZE; publish(); } };
}
