import { readHeldEditableText, replaceHeldEditableText } from "./held-queue-edit.mjs";
import { createHeldDisplayRow, createHeldEditRow, formatHeldInitialTime } from "./held-queue-presentation.mjs";
import { NATIVE_HELD_QUEUE_STYLE } from "./native-held-queue-style.mjs";
import { readNativeComposerThreadId } from "./native-composer-thread-id.mjs";
import { createNativeClaimTaskBridge } from "./native-claim-task-control.mjs";
import { createNativeSaveDraftTodoButton } from "./native-save-draft-control.mjs";
import { normalizeAssignedChecklistTasks, createAssignedChecklistState, resumeAssignedTask, updateHeldQueueShell } from "./native-assigned-checklist-tasks.mjs";
import { appendNativeHeldTodoRows, orderNativeHeldTodoEntries } from './native-held-todo-rows.mjs';
import { reloadWithHeldDraft, restoreNativeHeldDraft } from "./native-held-draft-recovery.mjs";
import { summarizeNativeHeldMessage } from "./native-held-message-summary.mjs";
import { createNativeHeldQueueRequest } from "./native-held-queue-bridge.mjs";
import{noThread}from"./native-composer-availability.mjs";
import { returnAssignedTodo } from './native-checklist-return.mjs';
import { createNativeHeldImageTools } from './native-held-image-tools.mjs';
import { saveNativeHeldDraft } from './native-held-draft-save.mjs';
import { readHeldViews, readHeldView } from './held-queue-view-storage.mjs';
import { readNativeTodoOrder, writeNativeTodoOrder, moveNativeTodoEntry, bootstrapNativeTodoOrder } from './native-held-todo-order.mjs';
import { pauseNativeQueuedItem, resumeNativeHeldItem, reorderNativeQueuedItems } from './native-held-queue-operations.mjs';
import { clearDraftText } from './native-held-draft-clear.mjs';

export function buildNativeComposerHeldQueueInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-26.federated-delivery1', LEGACY = '2026-09-18.3';
  const SAVE_DRAFT_VERSION = '2026-09-23.reassign1', LEGACY_SAVE = '2026-09-18.1';
  if (window.__codexControlConsoleHeldQueueInstalledVersion === VERSION && window.__codexControlConsoleSaveDraftTodoInstalledVersion === SAVE_DRAFT_VERSION && window.__codexControlConsoleHeldQueueObserver && window.__codexControlConsoleSaveDraftTodoObserver) return;
  window.__codexControlConsoleHeldQueueObserver?.disconnect?.();
  window.__codexControlConsoleHeldQueueInputCleanup?.();
  window.__codexControlConsoleHeldQueueTimer && clearInterval(window.__codexControlConsoleHeldQueueTimer);
  window.__codexControlConsoleHeldQueueRefreshTimer && clearInterval(window.__codexControlConsoleHeldQueueRefreshTimer);
  window.__codexControlConsoleSaveDraftTodoObserver?.disconnect?.();
  window.__codexControlConsoleSaveDraftTodoInputCleanup?.();
  document.querySelector('[data-ccc-held-queue-button]')?.remove();
  document.querySelector('[data-ccc-save-draft-todo]')?.remove();
  document.querySelector('[data-ccc-claim-task]')?.remove();
  document.querySelector('[data-ccc-held-queue-panel]')?.remove();
  document.querySelector('[data-ccc-held-queue-style]')?.remove();
  window.__codexControlConsoleHeldQueueInstalledVersion = VERSION;
  window.__codexControlConsoleSaveDraftTodoInstalledVersion = SAVE_DRAFT_VERSION;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const readThreadId = ${readNativeComposerThreadId.toString()};
  const STORE_KEY = 'codex-control-console.native-held-queue.v1', VIEW_KEY = STORE_KEY + '.view', ORDER_KEY = STORE_KEY + '.order', DRAFT_KEY = STORE_KEY + '.recovery-draft';
  const MAX_HELD = 100;
  const SAVE_STYLE = 'display:inline-flex;order:1;align-items:center;height:28px;padding:0 9px;border:1px solid #8884;border-radius:999px;background:none;color:inherit;font-size:12px';
  const HELD_ORIGINS = new Set(['draft', 'paused-queue']);
  let open = false;
  let busy = false;
  let serverItems = [], warning = '', editing = null, heldView = 'manage';
  const staleThreads = new Set();
  let activeThreadId = null;


  ${readHeldEditableText.toString()}
  ${replaceHeldEditableText.toString()} ${formatHeldInitialTime.toString()}
  ${createHeldDisplayRow.toString()} ${createHeldEditRow.toString()}
  ${appendNativeHeldTodoRows.toString()} ${orderNativeHeldTodoEntries.toString()}
  ${normalizeAssignedChecklistTasks.toString()} ${createAssignedChecklistState.toString()}
  ${resumeAssignedTask.toString()} ${updateHeldQueueShell.toString()}
  ${restoreNativeHeldDraft.toString()}
  ${reloadWithHeldDraft.toString()}
  ${summarizeNativeHeldMessage.toString()}
  ${createNativeHeldImageTools.toString()}
  ${saveNativeHeldDraft.toString()}
  ${returnAssignedTodo.toString()}
  ${readHeldViews.toString()} ${readHeldView.toString()}
  ${readNativeTodoOrder.toString()} ${writeNativeTodoOrder.toString()} ${moveNativeTodoEntry.toString()} ${bootstrapNativeTodoOrder.toString()}
  ${pauseNativeQueuedItem.toString()} ${resumeNativeHeldItem.toString()} ${reorderNativeQueuedItems.toString()}
  ${clearDraftText.toString()}

  const style = document.createElement('style');
  style.dataset.cccHeldQueueStyle = '';
  style.textContent = ${JSON.stringify(NATIVE_HELD_QUEUE_STYLE)};
  document.head.append(style);

  function threadId() { return readThreadId(document); }
  const assignedState = createAssignedChecklistState(threadId);
  function syncThreadState(id) {
    if (activeThreadId === id) return false;
    activeThreadId = id; serverItems = []; assignedState.clear(); editing = null; warning = ''; heldView = readHeldView(id); return true;
  }
  const claimTasks = ${createNativeClaimTaskBridge.toString()}(threadId);
  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  function validHeld(item) {
    return item && UUID.test(String(item.id || '')) && item.input != null && typeof item.input === 'object' && Number.isFinite(item.heldAt) && (item.origin == null || HELD_ORIGINS.has(item.origin));
  }
  function heldFor(id) { return (readStore()[id] || []).filter(validHeld).slice(0, MAX_HELD); }
  function setHeldView(id, view) { const values = readHeldViews(); values[id] = view; localStorage.setItem(VIEW_KEY, JSON.stringify(values)); heldView = view; render(); }
  function todoEntries(id) {
    const assigned = assignedState.forThread(id), held = heldFor(id).filter(item => !assigned.some(task => task.id === item.id));
    return orderNativeHeldTodoEntries(held, assigned, heldView, bootstrapNativeTodoOrder(localStorage, ORDER_KEY, id, held, assigned));
  }
  function moveTodo(id, taskId, offset) {
    if (busy || id !== threadId()) return;
    const order = moveNativeTodoEntry(todoEntries(id), taskId, offset);
    if (!order) return;
    try { writeNativeTodoOrder(localStorage, ORDER_KEY, id, order); warning = ''; } catch { warning = '无法保存待办顺序'; }
    render();
  }
  function writeHeld(id, items) {
    if (items.length > MAX_HELD) throw new Error('待办消息已达 100 条，请先整理后再保存');
    const store = readStore();
    store[id] = items.filter(validHeld);
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    try { window.dispatchEvent(new Event('codex-control-console-held-todos-changed')); } catch {}
  }
  const summarize = summarizeNativeHeldMessage;
  const imageTools = createNativeHeldImageTools();
  const request = (${createNativeHeldQueueRequest.toString()})();
  async function listQueue(id) {
    const items = [];
    let cursor = null;
    do {
      const page = await request('thread/queue/list', { threadId: id, cursor });
      items.push(...(Array.isArray(page?.data) ? page.data : []));
      cursor = page?.nextCursor || null;
    } while (cursor && items.length < 200);
    return items.slice(0, 200);
  }
  function button(label, handler, disabled = false) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.disabled = disabled;
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void handler(); });
    return node;
  }
  function setBusy(value) { busy = value; render(); }
  function queueIdentity(items) { return items.map((item) => String(item?.id || '')).join('|'); }
  async function refresh() {
    const id = threadId();
    if (!id || busy) return;
    let changed = false;
    try { const next = await listQueue(id); if (id !== threadId()) return; changed = queueIdentity(serverItems) !== queueIdentity(next) || Boolean(warning); serverItems = next; warning = ''; }
    catch (error) { if (id !== threadId()) return; const nextWarning = error.message || '无法读取原生队列'; changed = warning !== nextWarning; warning = nextWarning; }
    if (changed) render();
  }
  async function pauseItem(id, item, editAfterPause = false) {
    return pauseNativeQueuedItem(id, item, editAfterPause, queueActions);
  }
  async function resumeItem(id, held) {
    if (legacyIsSynchronizing(id, held)) { legacyPendingWarning(); return; }
    return resumeNativeHeldItem(id, held, queueActions);
  }
  async function reorderServer(id, index, offset) {
    return reorderNativeQueuedItems(id, index, offset, queueActions);
  }
  const queueActions = { busy: () => busy, threadId, setBusy, heldFor, writeHeld, request, listQueue, imageTools, summarize,
    readEditableText: readHeldEditableText, serverItems: () => serverItems, setServerItems: value => { serverItems = value; },
    setEditing: value => { editing = value; }, migrateLegacyTodos: () => window.__cccProjectChecklist?.migrateLegacyTodos?.(), warn: value => { warning = value; render(); } };
  function legacyPendingWarning() { warning = '旧待办正在同步到任务中心，请稍后重试'; render(); }
  function legacyIsSynchronizing(id, held) { const bridge = window.__cccProjectChecklist; return bridge?.legacyTaskPending?.(held.id, id) || bridge?.assignedTasksForThread?.(id)?.some(task => task.id === held.id); }
  function refreshAssignedSnapshot(id) { const items = window.__cccProjectChecklist?.assignedTasksForThread?.(id); if (Array.isArray(items)) assignedState.publish({ threadId: id, items }); }
  function deleteAssigned(task) {
    const id = threadId();
    if (busy || !assignedState.owns(id, task)) return;
    if (!window.__cccProjectChecklist?.deleteAssignedTask?.(task.id, id, task.text)) warning = '无法删除任务，请同步后重试';
    else { warning = ''; refreshAssignedSnapshot(id); }
    render();
  }
  async function removeHeld(id, held) {
    if (legacyIsSynchronizing(id, held)) { legacyPendingWarning(); return; }
    try { writeHeld(id, heldFor(id).filter((item) => item.id !== held.id)); await imageTools.release(held.input); warning = ''; }
    catch (error) { warning = error.message || '无法删除待办'; }
    render();
  }
  function startHeldEdit(held) {
    const value = readHeldEditableText(held.input);
    if (value == null) { warning = '这条待办没有可安全编辑的单一文字内容'; render(); return; }
    editing = { id: held.id, value }; warning = ''; render();
  }
  function cancelHeldEdit() { editing = null; render(); }
  function saveHeldEdit(id, held) {
    const input = replaceHeldEditableText(held.input, editing?.value);
    if (!input) { warning = '待办内容不能为空'; render(); return; }
    const items = heldFor(id), index = items.findIndex((item) => item.id === held.id);
    if (index < 0) { warning = '待办已经变化，请重新打开'; editing = null; render(); return; }
    items[index] = { ...items[index], input, summary: summarize(input), editedAt: Date.now() };
    try { writeHeld(id, items); editing = null; warning = ''; }
    catch (error) { warning = error.message || '无法保存待办修改'; }
    render();
  }
  function startAssignedEdit(task) { if (busy || !assignedState.owns(threadId(), task)) return; editing = { id: task.id, value: task.text, source: 'assigned' }; render(); }
  function saveAssignedEdit(id, task) {
    if (busy || id !== threadId() || !assignedState.owns(id, task)) return;
    const value = String(editing?.value || '').trim();
    if (!window.__cccProjectChecklist?.editAssignedTask?.(task.id, id, task.text, value)) warning = '无法保存任务修改，请同步后重试';
    else { editing = null; warning = ''; refreshAssignedSnapshot(id); }
    render();
  }
  function draftText(editor) {
    const markdown = editor?.getAttribute?.('data-composer-markdown');
    if (typeof markdown === 'string' && markdown.trim()) return markdown.trim();
    return (editor?.textContent || '').trim();
  }
  function updateDraftButton() {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const save = document.querySelector('[data-ccc-save-draft-todo]');
    if (save) {
      const disabled = busy || (!draftText(editor) && !imageTools.images(editor).length), opacity = disabled ? '.35' : '1', cursor = disabled ? 'default' : 'pointer';
      if (save.disabled !== disabled) save.disabled = disabled;
      if (save.style.opacity !== opacity) save.style.opacity = opacity;
      if (save.style.cursor !== cursor) save.style.cursor = cursor;
    }
  }
  async function saveDraftTodo() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    if (busy || !id || !editor) return;
    await saveNativeHeldDraft({ threadId, editor, readText: draftText, imageTools,
      clearText: clearDraftText, setBusy: (value) => { busy = value; },
      setWarning: (value) => { warning = value; }, render, updateButton: updateDraftButton });
  }
  const draftTodoButton = ${createNativeSaveDraftTodoButton.toString()}(saveDraftTodo);
  function makeSaveButton() { const save = draftTodoButton(); save.dataset.cccSaveDraftTodo = ''; save.title = '把当前文字和图片保存为待办，不加入发送队列'; save.style.cssText = SAVE_STYLE; return save; }
  function syncNative() { reloadWithHeldDraft(threadId, draftText, DRAFT_KEY); }
  const updateShell = (id, toolbar, panel) => updateHeldQueueShell(toolbar, panel, serverItems, heldFor(id), assignedState.forThread(id), warning || staleThreads.has(id), open);
  function render() {
    const id = threadId(), toolbar = document.querySelector('[data-ccc-held-queue-button]'), panel = document.querySelector('[data-ccc-held-queue-panel]');
    syncThreadState(id);
    if (!id || !toolbar || !panel) return;
    const assignedTasks = assignedState.forThread(id);
    const entries = todoEntries(id), held = heldFor(id).filter(item => !assignedTasks.some(task => task.id === item.id));
    const stale = staleThreads.has(id);
    updateShell(id, toolbar, panel);
    panel.replaceChildren();
    const head = document.createElement('div'); head.dataset.cccHeldHead = '';
    const title = document.createElement('strong'); title.textContent = '待办';
    const state = document.createElement('span'); state.textContent = serverItems.length + ' 排队 · ' + (held.length + assignedTasks.length) + ' 待办';
    const views = document.createElement('span'); views.dataset.cccHeldViews = '';
    views.append(button('管理', () => setHeldView(id, 'manage'), heldView === 'manage'), button('排序', () => setHeldView(id, 'sort'), heldView === 'sort'), button('时间', () => setHeldView(id, 'time'), heldView === 'time'));
    head.append(title, views, state); panel.append(head);
    if (warning || stale) { const note = document.createElement('p'); note.dataset.cccHeldWarning = ''; note.textContent = warning || '原生队列状态已经过期，当前输入仍保留；请同步后重试。'; note.append(' ', button('同步原生队列', syncNative)); panel.append(note); }
    const list = document.createElement('div'); list.dataset.cccHeldList = '';
    serverItems.forEach((item, index) => list.append(createHeldDisplayRow('排队', summarize(item.input), heldView === 'sort'
      ? [button('上移', () => reorderServer(id, index, -1), busy || index === 0), button('下移', () => reorderServer(id, index, 1), busy || index === serverItems.length - 1)]
      : [button('编辑', () => pauseItem(id, item, true), busy), button('暂停', () => pauseItem(id, item), busy)])));
    const returnTask = (task) => returnAssignedTodo(task, { threadId: id, isCurrent: () => threadId() === id, busy: () => busy, setBusy, setWarning: (value) => { warning = value; } });
    appendNativeHeldTodoRows(list, entries, createHeldDisplayRow, createHeldEditRow, button, {
      editing, busy, sorting: heldView === 'sort', summarize,
      save: item => editing?.source === 'assigned' ? saveAssignedEdit(id, item) : saveHeldEdit(id, item), cancel: cancelHeldEdit,
      edit: (source, item) => source === 'assigned' ? startAssignedEdit(item) : startHeldEdit(item),
      move: (taskId, offset) => moveTodo(id, taskId, offset),
      remove: (source, item) => source === 'assigned' ? deleteAssigned(item) : removeHeld(id, item),
      returnTask: (source, item) => source === 'assigned' ? returnTask(item) : legacyPendingWarning(),
      resume: (source, item) => source === 'held' ? resumeItem(id, item) : resumeAssignedTask(item, { threadId: id, isCurrent: () => threadId() === id, ownsTask: value => assignedState.owns(id, value), busy: () => busy, setBusy, request, hydrateInput: value => value.input ? imageTools.hydrate(value.input) : [{ type: 'text', text: value.text }], removeAssigned: taskId => assignedState.remove(id, taskId), setServerItems: items => { serverItems = items; }, listQueue, setWarning: value => { warning = value; } }),
      reassign: (source, task) => { if (source !== 'assigned') return legacyPendingWarning(); if (busy || threadId() !== id || !assignedState.owns(id, task)) return; if (!window.__cccProjectChecklist?.openReassignTask?.(task.id, id, task.text)) { warning = '任务状态已变化，请同步后重试'; render(); } }
    });
    if (!serverItems.length && !held.length && !assignedTasks.length) { const empty = document.createElement('div'); empty.dataset.cccHeldEmpty = ''; empty.textContent = '没有排队或待办'; list.append(empty); }
    panel.append(list);
  }
  const restoreDraft = () => restoreNativeHeldDraft(threadId, DRAFT_KEY);
  function install() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]'), root = editor?.closest('[data-composer-surface-variant]');
    const threadChanged = syncThreadState(id);
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement;
    if (!root || !host) { document.querySelector('[data-ccc-held-queue-button]')?.remove(); document.querySelector('[data-ccc-save-draft-todo]')?.remove(); document.querySelector('[data-ccc-claim-task]')?.remove(); document.querySelector('[data-ccc-held-queue-panel]')?.remove(); return; }
    ${noThread('held')}
    if (threadChanged && open) void refresh();
    let toolbar = document.querySelector('[data-ccc-held-queue-button]');
    if (!toolbar) { toolbar = button('待办', () => { open = !open; render(); if (open) void refresh(); }); toolbar.dataset.cccHeldQueueButton = ''; host.append(toolbar); }
    let save = document.querySelector('[data-ccc-save-draft-todo]');
    if (!save) { save = makeSaveButton(); host.insertBefore(save, toolbar); }
    claimTasks.ensure(host, toolbar);
    let panel = document.querySelector('[data-ccc-held-queue-panel]'); const panelCreated = !panel;
    if (panelCreated) { panel = document.createElement('section'); panel.dataset.cccHeldQueuePanel = ''; panel.hidden = true; root.prepend(panel); }
    restoreDraft();
    if (threadChanged || panelCreated) render(); else updateShell(id, toolbar, panel);
    updateDraftButton();
  }
  function installSaveDraftTodo() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement;
    if (!editor || !host) { document.querySelector('[data-ccc-save-draft-todo]')?.remove(); document.querySelector('[data-ccc-claim-task]')?.remove(); return; }
    ${noThread('draft')}
    let save = document.querySelector('[data-ccc-save-draft-todo]');
    if (!save) {
      save = makeSaveButton();
      const manager = document.querySelector('[data-ccc-held-queue-button]'); host.insertBefore(save, manager?.parentElement === host ? manager : null);
    }
    claimTasks.ensure(host, document.querySelector('[data-ccc-held-queue-button]'));
    updateDraftButton();
  }
  let installTimer = null, saveDraftInstallTimer = null;
  function schedule() { clearTimeout(installTimer); installTimer = setTimeout(install, 50); }
  function scheduleSaveDraftTodo() { clearTimeout(saveDraftInstallTimer); saveDraftInstallTimer = setTimeout(installSaveDraftTodo, 50); }
  function containsStaleQueueAlert(node) {
    if (node?.nodeType !== 1) return false;
    const notices = node.matches?.('[role="alert"],[data-sonner-toast]') ? [node] : [...(node.querySelectorAll?.('[role="alert"],[data-sonner-toast]') || [])];
    return notices.some((notice) => /App-server queued follow-up no longer exists/i.test(notice.textContent || ''));
  }
  window.__codexControlConsoleHeldQueueObserver = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes].some(containsStaleQueueAlert))) { const id = threadId(); if (id) staleThreads.add(id); open = true; render(); }
    if (records.some((record) => [...record.addedNodes, ...(record.removedNodes || [])].some((node) => node.nodeType === 1 && (node.matches?.('img') || node.querySelector?.('img'))))) updateDraftButton();
    const id = threadId();
    if (id !== activeThreadId) install();
    else if (id && (!document.querySelector('[data-ccc-held-queue-button]') || !document.querySelector('[data-ccc-held-queue-panel]'))) schedule();
    if (!document.querySelector('[data-ccc-save-draft-todo]') || !document.querySelector('[data-ccc-claim-task]')) scheduleSaveDraftTodo();
  });
  window.__codexControlConsoleHeldQueueObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'data-app-action-sidebar-thread-selected', 'data-app-action-sidebar-thread-id', 'data-above-composer-conversation-id'] });
  document.addEventListener('input', updateDraftButton, true);
  document.addEventListener('change', updateDraftButton, true);
  const removeDraftInputListener = () => { document.removeEventListener('input', updateDraftButton, true); document.removeEventListener('change', updateDraftButton, true); };
  window.__codexControlConsoleHeldQueueInputCleanup = removeDraftInputListener;
  window.__codexControlConsoleSaveDraftTodoInputCleanup = removeDraftInputListener;
  window.__codexControlConsoleSaveDraftTodoObserver = window.__codexControlConsoleHeldQueueObserver;
  window.__codexControlConsoleHeldQueueTimer = setInterval(() => { const id = threadId();
    if (id !== activeThreadId || (id && (!document.querySelector('[data-ccc-held-queue-button]') || !document.querySelector('[data-ccc-held-queue-panel]')))) install(); }, 1000);
  window.__codexControlConsoleHeldQueueRefreshTimer = setInterval(() => { if (open && !busy && !editing) void refresh(); }, 4000);
  window.__codexControlConsoleRefreshHeldQueue = refresh;
  window.__codexControlConsoleSetClaimableTaskCount = claimTasks.set;
  window.__codexControlConsoleSetAssignedChecklistTasks = (snapshot) => {
    const threadChanged = syncThreadState(threadId()), changed = assignedState.publish(snapshot);
    if (threadChanged || changed) render();
    return assignedState.forThread(threadId()).length;
  };
  window.__codexControlConsoleHeldQueueVersion = LEGACY;
  window.__codexControlConsoleSaveDraftTodoVersion = LEGACY_SAVE;
  schedule(); scheduleSaveDraftTodo();
})();`;
}
