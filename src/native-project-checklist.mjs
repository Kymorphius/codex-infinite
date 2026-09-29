import { createNativeChecklistTaskRow } from './native-checklist-task-row.mjs';
import { focusNativeChecklistTask, createNativeChecklistReassignController } from './native-checklist-board-jump.mjs';
import { createNativeChecklistAssignmentControl } from './native-checklist-assignment-control.mjs';
import { nativeChecklistStyles } from './native-checklist-style.mjs';
import { createChecklistDeliveryBridge } from './native-checklist-delivery.mjs';
import { createChecklistConflictView } from './native-checklist-conflicts.mjs';

export function installNativeProjectChecklist(readHeldTodos = () => [], readConversationChoices = () => [], readThreadId = () => null, createReturns, readTime, createTimePresentation, createTaskEditor, createSearch, createThreadStarter, createNewThreadClaim, syncBinding, normalizeInput, makeImageTools, assignedChecklistTasksForThread, makePasteImages, makeTaskModel) {
  const VERSION = '2026-09-29.render-gate', KEY = 'ccc.project-checklist.pending.v1', GENERAL_KEY = 'ccc:general-inbox:v1';
  if (window.__cccProjectChecklist?.version === VERSION) return;
  window.__cccProjectChecklist?.dispose();
  let project = null, items = [], generalItems = [], generalLoaded = false, held = [], heldLoaded = false, heldLoadScheduled = false, loaded = '', pending = [], error = '', claimWarning = '', storageError = '', renderVersion = 0;
  const instanceId = `${Date.now()}-${Math.random()}`;
  const taskImages = makeImageTools();
  const taskEditors = new Map();
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) pending = saved; }
  catch { storageError = '无法读取待保存任务，请勿关闭窗口'; }
  const make = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const time = createTimePresentation(readTime);
  const search = createSearch(make);
  const style = make('style'); style.textContent = nativeChecklistStyles();
  const dialog = make('dialog'); dialog.setAttribute('data-ccc-checklist', ''); dialog.setAttribute('aria-label', '项目任务清单');
  const header = make('header'), title = make('h2', '任务清单'), close = make('button', '关闭'); header.append(title, close);
  const subtitle = make('div'), description = make('p'), form = make('form'), input = make('input'), add = make('button', '添加');
  subtitle.setAttribute('data-checklist-controls', ''); subtitle.append(description, search.root);
  input.type = 'text'; input.maxLength = 5000; input.placeholder = '想在这个项目里做什么？'; input.setAttribute('aria-label', '新任务'); add.type = 'submit';
  const pasted = make('small'), count = make('small'), list = make('ul'), status = make('small'); count.setAttribute('data-checklist-count', ''); pasted.dataset.checklistPastedImages = ''; pasted.hidden = true; pasted.setAttribute('aria-live', 'polite'); status.setAttribute('role', 'status');
  form.append(input, pasted, add); dialog.append(header, subtitle, form, count, list, status, make('small', '按加入时间从早到晚 · 变更保存在任务来源设备 · 勾选记录完成状态'));
  document.head.append(style); document.body.append(dialog);
  const conflicts = createChecklistConflictView({ make, readPending: () => pending, dismiss: requestId => { pending = pending.filter(action => action.requestId !== requestId); persist(); state(); } }); dialog.append(conflicts.root);
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(pending)); storageError = ''; } catch { storageError = '任务尚未保存到草稿，请勿关闭窗口'; } }
  let taskPaste = null, taskModel = null, focusTaskId = null;
  function showPastedImages() { taskPaste?.render(pasted, add, loaded === project?.key); }
  const metadata = item => ({ ...(item.assignedProvider ? { assignedProvider: item.assignedProvider } : {}), ...(item.sourceRef ? { sourceRef: item.sourceRef, expectedRevision: item.expectedRevision, readOnly: item.readOnly, sourceConnected: item.sourceConnected, ...(item.attachmentError ? { attachmentError: item.attachmentError } : {}) } : {}), ...(item.assignedDeviceId ? { assignedDeviceId: item.assignedDeviceId } : {}), ...(item.executionState ? { executionState: item.executionState } : {}), ...(item.reservationToken ? { reservationToken: item.reservationToken } : {}), ...(item.deliveryReservation ? { deliveryReservation: item.deliveryReservation } : {}) });
  function view(projectKey = project?.key, source = items) {
    const result = source.map(item => ({ id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null, ...readTime(item), ...(Array.isArray(item.input) ? { input: item.input } : {}), ...metadata(item) }));
    for (const action of pending.filter(value => !value.conflict && value.projectKey === projectKey && !['verify-delivery', 'release-delivery'].includes(value.type))) {
      const index = result.findIndex(item => item.id === action.id);
      if (action.type === 'delete') { if (index >= 0) result.splice(index, 1); }
      else { const previous = index >= 0 ? result[index] : action; const item = { id: action.id, text: action.text, done: action.done, assignedThreadId: action.assignedThreadId || null, ...readTime(previous), ...(Array.isArray(action.input ?? previous.input) ? { input: action.input ?? previous.input } : {}), ...metadata(previous), ...metadata(action) }; if (index >= 0) result[index] = item; else result.push(item); }
    }
    return result;
  }
  function state() {
    const busy = pending.some(action => !action.conflict && action.projectKey === project?.key);
    conflicts.render();
    const message = storageError || claimWarning || error || (busy ? '正在保存…' : loaded === project?.key ? '已保存' : '正在读取…');
    if (status.textContent !== message) status.textContent = message; // assigning the same text still replaces the node
    input.disabled = loaded !== project?.key; add.disabled = Boolean(taskPaste?.busy()) || loaded !== project?.key;
  }
  function act(type, item, projectKey = project.key, refresh = true, providedRequestId = null) {
    if (item.readOnly && !(item.reservationToken && item.reservationToken === item.deliveryReservation?.token)) { error = item.attachmentError || '任务来源设备未连接，请连接后重试'; state(); return null; }
    const requestId = providedRequestId || crypto.randomUUID();
    pending.push({ projectKey, type, id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null, ...(item.input ? { input: item.input } : {}), ...metadata(item), ...(item.creation ? { creation: true } : {}), ...(item.legacyHeldSource ? { legacyHeldSource: item.legacyHeldSource } : {}), ...(item.createdAt ? readTime(item) : {}), requestId });
    persist(); if (refresh) render(); else state();
    return requestId;
  }
  taskModel = makeTaskModel({ generalKey: GENERAL_KEY, heldKey: 'codex-control-console.native-held-queue.v1', syncBinding, documentRef: document, localStorageRef: localStorage, windowRef: window, normalizeInput, readThreadId: doc => readThreadId(doc), readGeneralItems: () => generalItems, readPending: () => pending,
    enqueueAction(item, projectKey) { const requestId = act('upsert', item, projectKey, false); if (!requestId || storageError) { pending = pending.filter(action => action.requestId !== requestId); persist(); return false; } return true; },
    setAssignedSnapshot: value => window.__codexControlConsoleSetAssignedChecklistTasks?.(value),
    onSaved: projectKey => { if (project?.key === projectKey) render(); else state(); }
  });
  const delivery = createChecklistDeliveryBridge({ readItems: () => view(GENERAL_KEY, generalItems), enqueue: (item, requestId, type) => act(type, item, GENERAL_KEY, false, requestId), signal: () => { try { window[syncBinding]?.('verify-delivery'); } catch {} } });
  taskPaste = makePasteImages({ taskImages, cryptoRef: crypto, onError: message => { error = message; state(); }, onChange: showPastedImages });
  taskPaste.bind(form);
  const appendAssignmentControl = createNativeChecklistAssignmentControl({ make, dialog, getProject: () => project, getLoaded: () => loaded, getRenderVersion: () => renderVersion, readChoices: () => readConversationChoices(document), view, generalItems: () => generalItems, act, render, state: message => { error = message; state(); } });
  const returns = createReturns({
    readItems: () => view(GENERAL_KEY, generalItems), readThreadId: () => readThreadId(document),
    enqueue(action) {
      pending.push(action); persist();
      if (storageError) { pending = pending.filter(value => value.requestId !== action.requestId); throw new Error(storageError); }
      render();
      try { window[syncBinding]?.('return'); } catch { /* periodic sync remains the recovery path */ }
    }
  });
  const todoMutations = createNativeChecklistTodoMutations({
    readThreadId: () => readThreadId(document), readItems: () => view(GENERAL_KEY, generalItems),
    enqueue: (type, item) => { const requestId = act(type, item, GENERAL_KEY); if (!requestId || storageError) { pending = pending.filter(action => action.requestId !== requestId); render(); return false; } try { window[syncBinding]?.('todo'); } catch {} return true; },
    replaceText: (input, value) => replaceHeldEditableText(input, value) || (!input.some(part => part.type === 'text') ? [{ type: 'text', text: value }, ...input] : null)
  });
  const reassign = createNativeChecklistReassignController({ readThreadId: () => readThreadId(document), readItems: () => view(GENERAL_KEY, generalItems), openGeneral: () => window.__cccProjectChecklist.openGeneral(), getLoaded: () => loaded === GENERAL_KEY, isOpen: () => dialog.open, list, warn: message => { claimWarning = message; state(); }, render: () => render() });
  const newThreadClaim = createNewThreadClaim({
    start: createThreadStarter(), prepare: (task, requestId) => delivery.prepare(task.id, null, null, requestId, task.expectedRevision), release: delivery.release, storage: localStorage,
    readTask: id => view(GENERAL_KEY, generalItems).find(item => item.id === id),
    enqueue(item) {
      const requestId = act('upsert', item, GENERAL_KEY, false);
      if (storageError) { pending = pending.filter(action => action.requestId !== requestId); return null; }
      if (project?.key === GENERAL_KEY) render();
      return requestId;
    },
    report(message) { claimWarning = message; state(); },
    showFailure() { if (!dialog.open) dialog.showModal(); }
  });
  function render() {
    const drafts = new Map([...taskEditors].map(([id, editor]) => [id, editor.snapshot()])); taskEditors.clear(); search.resetRows();
    const version = ++renderVersion;
    state(); list.replaceChildren(); const values = time.order(view().filter(item => item.executionState !== 'delivered')), claiming = Boolean(project?.claimThreadId || project?.claimNewThread), projectedHeld = project?.general && !claiming ? held.filter(item => !values.some(task => task.id === item.id)) : [];
    const assigned = project?.general && !claiming ? values.filter(item => !item.done && item.assignedThreadId) : [];
    const visible = claiming ? values.filter(item => !item.done && !item.assignedThreadId) : project?.general ? values.filter(item => !item.assignedThreadId) : values;
    count.textContent = project?.general ? `${visible.filter(item => !item.done).length} 项未指派 · ${values.filter(item => item.done).length} 项已完成 · ${heldLoaded ? assigned.length + projectedHeld.length + ' 项会话待办' : '正在加载会话待办…'}` : `${values.filter(item => !item.done).length} 项待办 · ${values.filter(item => item.done).length} 项已完成`;
    if (!visible.length && !assigned.length && (!heldLoaded || !projectedHeld.length)) list.append(make('li', loaded === project?.key ? (project?.general && !heldLoaded ? '正在加载会话待办…' : '还没有任务，先记下一件想做的事。') : '正在读取清单…'));
    for (const item of visible) {
      const result = createNativeChecklistTaskRow({ item, project, version, renderVersion: () => renderVersion, dialog, loaded, generalItems: () => generalItems, items: () => items, make, createTaskEditor, drafts, taskEditors, view, act, appendAssignmentControl, appendTime, searchRegister: search.register, readTask: id => view(GENERAL_KEY, generalItems).find(value => value.id === id), setError: message => { error = message; state(); }, newThreadClaim });
      list.append(result.row);
    }
    for (const item of time.order([...assigned.map(value => ({ ...value, assignedChecklist: true })), ...projectedHeld])) {
      const row = make('li'), source = make('small', item.assignedChecklist ? '会话待办' : item.origin), text = make('input'), open = make('button', '打开会话');
      row.setAttribute('data-checklist-row', '');
      if (item.assignedChecklist) row.dataset.checklistTaskId = item.id;
      row.setAttribute('data-ccc-held-todo', ''); text.type = 'text'; text.value = item.text; text.disabled = true; text.title = '会话待办属于所指派的会话；可在该会话中编辑、加入发送队列、重派、退回或删除。';
      search.register(row, () => text.value);
      if (item.assignedChecklist) { row.append(source, text); appendAssignmentControl(row, item, '改派会话'); appendTime(row, item); list.append(row); continue; }
      open.addEventListener('click', () => {
        const openNativeThread = window.__codexControlConsoleOpenNativeThread;
        if (typeof openNativeThread === 'function') void openNativeThread(item.threadId).catch(() => {});
        else window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(item.threadId) }, '*');
        dialog.close();
      });
      row.append(source, text, open); appendTime(row, item); list.append(row);
    }
    search.apply();
    reassign.afterRender();
    if (focusTaskId && dialog.open && loaded === project?.key && focusNativeChecklistTask(list, focusTaskId)) focusTaskId = null;
  }
  function appendTime(row, item) { const detail = time.describe(item), stamp = make('time', detail.label); stamp.setAttribute('data-checklist-added', ''); if (detail.dateTime) stamp.setAttribute('datetime', detail.dateTime); stamp.title = detail.title; row.append(stamp); }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (loaded !== project?.key || taskPaste.busy()) return;
    const text = input.value.trim(), images = taskPaste.images(); if (!text && !images.length) return;
    let payload; try { payload = normalizeInput([...(text ? [{ type: 'text', text }] : []), ...images]); }
    catch (reason) { error = reason.message || '任务内容无效'; state(); return; }
    if (!taskModel.enqueueTask({ id: crypto.randomUUID(), text: text || `图片任务（${images.length} 张）`, done: false, assignedThreadId: null, input: payload, createdAt: new Date().toISOString() }, project.key)) { error = storageError || '任务尚未安全保存'; state(); return; }
    taskPaste.consume(); input.value = ''; showPastedImages(); input.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('close', () => { void taskPaste.discard(); });
  window.__cccProjectChecklist = { version: VERSION,
    returnAssignedTask: returns.returnAssignedTask,
    createAssignedTask: taskModel.createAssignedTask,
    assignedTasksForThread: taskModel.tasksForThread,
    hasLegacyDrafts: taskModel.hasLegacyDrafts,
    legacyTaskPending: taskModel.legacyTaskPending,
    migrateLegacyTodos() { return taskModel.migrateLegacyDrafts(true); },
    openGeneral(taskId = null) { focusTaskId = typeof taskId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(taskId) ? taskId : null; this.open({ key: GENERAL_KEY, general: true, name: '记下任务，再领取或指派给会话。' }); if (focusTaskId && loaded === project?.key) render(); },
    openReassignTask(id, threadId, text) { return reassign.open(id, threadId, text); },
    editAssignedTask: todoMutations.edit,
    deleteAssignedTask: todoMutations.delete,
    prepareAssignedTask: delivery.prepare,
    releaseAssignedTask: delivery.release,
    openClaimableForCurrentThread(threadId) { this.open({ key: 'ccc:general-inbox:v1', general: true, claimThreadId: threadId, name: '直接编辑任务内容；领取时使用框内最新内容，放入当前会话待办并保持暂停。领取不会发送消息。' }); },
    openClaimableForNewThread() { this.open({ key: GENERAL_KEY, general: true, claimNewThread: true, name: '直接编辑任务内容；点击领取会填入新任务输入框并发送，创建新会话。' }); },
    completeAssignedTask(id, threadId, text, reservation = {}) {
      if (!threadId || typeof text !== 'string') return false;
      const item = view(GENERAL_KEY, generalItems).find(value => value.id === id && (value.assignedProvider ?? 'codex') === 'codex' && !value.done && value.executionState !== 'delivered' && value.assignedThreadId === threadId && value.text === text);
      if (!item) return false;
      const requestId = act('upsert', { ...item, ...reservation, done: false, executionState: 'delivered' }, GENERAL_KEY);
      if (!requestId || storageError) { pending = pending.filter(action => action.requestId !== requestId); render(); return false; }
      try { window[syncBinding]?.('complete'); } catch { /* periodic sync remains the recovery path */ }
      return true;
    },
    open(value) { if (taskPaste.images().length) void taskPaste.discard(); title.textContent = value.general ? '综合任务清单' : '任务清单'; dialog.setAttribute('aria-label', value.general ? '综合任务清单' : '项目任务清单'); input.placeholder = value.general ? '有什么想做的？先记在这里…' : '想在这个项目里做什么？'; taskEditors.clear(); search.reset(); project = value; items = value.general && generalLoaded ? generalItems : []; held = []; heldLoaded = !value.general || !!value.claimThreadId || !!value.claimNewThread; form.hidden = Boolean(value.claimThreadId || value.claimNewThread); dialog.dataset.claim = String(form.hidden); loaded = value.general && generalLoaded ? value.key : ''; error = ''; claimWarning = ''; description.textContent = value.name || value.id; input.value = ''; showPastedImages(); render(); if (!dialog.open) dialog.showModal(); if (value.general) scheduleHeldLoad(); },
    cacheGeneral(nextItems, signalMigration = true) { if (!Array.isArray(nextItems)) return; generalItems = nextItems; generalLoaded = true; const migrationError = taskModel.migrateLegacyDrafts(signalMigration); if (migrationError) error = migrationError; if (project?.key === 'ccc:general-inbox:v1' && loaded !== project.key) { items = generalItems; loaded = project.key; render(); } },
    packet() { return { instanceId, projectKey: project?.key || '', actions: pending.filter(action => !action.conflict).slice(0, 20) }; },
    accept(result) {
      const before = JSON.stringify(view());
      const acknowledged = new Set(result.acknowledged || []), completed = pending.filter(action => acknowledged.has(action.requestId));
      const rejected = new Set(result.rejected || []);
      pending = pending.filter(action => !acknowledged.has(action.requestId) && !rejected.has(action.requestId)); persist(); error = result.error || '';
      for (const conflict of result.conflicts || []) for (const action of pending) if (action.projectKey === conflict.projectKey && action.id === conflict.id) action.conflict = conflict.error;
      for (const value of result.actionResults || []) for (const action of pending) if (action.projectKey === value.projectKey && action.id === value.id && action.expectedRevision === value.previousRevision) { action.expectedRevision = value.item.revision; action.sourceRef = { ownerDeviceId: value.item.ownerDeviceId, scopeId: value.item.scopeId, id: value.item.id }; delete action.creation; }
      persist();
      taskModel.completeLegacySources(completed);
      for (const action of completed) if (action.executionState === 'delivered') { try { localStorage.removeItem('ccc.checklist.delivery.v1:' + action.assignedThreadId + ':' + action.id); localStorage.removeItem('ccc.checklist.new-thread.v1:' + action.id); } catch {} }
      // With no project open (dialog closed) there is nothing to load; `loaded === ''` never equals the
      // undefined key, which made every sync rebuild the hidden dialog's list.
      const first = Boolean(project) && loaded !== project.key;
      if (result.projectKey === project?.key && Array.isArray(result.items)) { items = result.items; loaded = result.projectKey; if (result.projectKey === 'ccc:general-inbox:v1') { generalItems = result.items; generalLoaded = true; } }
      if (first || before !== JSON.stringify(view())) render(); else state();
      returns.accept(result);
      delivery.accept(result);
    },
    dispose() { returns.dispose(); delivery.dispose(); void taskPaste.discard(); window.removeEventListener('codex-control-console-held-todos-changed', refreshHeldTodos); dialog.remove(); style.remove(); }
  };
  function loadHeldTodos() { heldLoadScheduled = false; if (!project?.general || project.claimThreadId || project.claimNewThread) return; held = readHeldTodos(localStorage); heldLoaded = true; render(); }
  function scheduleHeldLoad() { if (heldLoadScheduled || heldLoaded || !project?.general || project.claimThreadId || project.claimNewThread) return; heldLoadScheduled = true; if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(loadHeldTodos, { timeout: 1000 }); else if (typeof setTimeout === 'function') setTimeout(loadHeldTodos, 0); else heldLoadScheduled = false; }
  function refreshHeldTodos() { if (project?.general && !project.claimThreadId && !project.claimNewThread) { heldLoaded = false; scheduleHeldLoad(); render(); } }
  window.addEventListener('codex-control-console-held-todos-changed', refreshHeldTodos);
}
export { buildNativeProjectChecklistScript } from './native-project-checklist-script.mjs';
