import { readHeldEditableText, replaceHeldEditableText } from "./held-queue-edit.mjs";
import { createHeldDisplayRow, createHeldEditRow, formatHeldInitialTime, orderHeldForView } from "./held-queue-presentation.mjs";
import { NATIVE_HELD_QUEUE_STYLE } from "./native-held-queue-style.mjs";
import { readNativeComposerThreadId } from "./native-composer-thread-id.mjs";
import { createNativeClaimTaskBridge } from "./native-claim-task-control.mjs";
import { createNativeSaveDraftTodoButton } from "./native-save-draft-control.mjs";
import { appendAssignedChecklistTaskRows, normalizeAssignedChecklistTasks, resumeAssignedTask, updateHeldQueueShell } from "./native-assigned-checklist-tasks.mjs";
import { reloadWithHeldDraft, restoreNativeHeldDraft } from "./native-held-draft-recovery.mjs";
import { summarizeNativeHeldMessage } from "./native-held-message-summary.mjs";
import{noThread}from"./native-composer-availability.mjs";

export function buildNativeComposerHeldQueueInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-22.9', LEGACY = '2026-09-18.3';
  const SAVE_DRAFT_VERSION = '2026-09-22.3', LEGACY_SAVE = '2026-09-18.1';
  if (window.__codexControlConsoleHeldQueueInstalledVersion === VERSION && window.__codexControlConsoleSaveDraftTodoInstalledVersion === SAVE_DRAFT_VERSION && window.__codexControlConsoleHeldQueueObserver && window.__codexControlConsoleSaveDraftTodoObserver) return;
  window.__codexControlConsoleHeldQueueObserver?.disconnect?.();
  window.__codexControlConsoleHeldQueueInputCleanup?.();
  window.__codexControlConsoleHeldQueueTimer && clearInterval(window.__codexControlConsoleHeldQueueTimer);
  window.__codexControlConsoleHeldQueueRefreshTimer && clearInterval(window.__codexControlConsoleHeldQueueRefreshTimer);
  window.__codexControlConsoleSaveDraftTodoObserver?.disconnect?.();
  window.__codexControlConsoleSaveDraftTodoInputCleanup?.();
  document.querySelector('[data-ccc-held-queue-button]')?.remove();
  document.querySelector('[data-ccc-save-draft-todo]')?.remove();
  document.querySelector('[data-ccc-held-queue-panel]')?.remove();
  document.querySelector('[data-ccc-held-queue-style]')?.remove();
  window.__codexControlConsoleHeldQueueInstalledVersion = VERSION;
  window.__codexControlConsoleSaveDraftTodoInstalledVersion = SAVE_DRAFT_VERSION;
  window.__codexControlConsoleHeldQueueVersion = LEGACY;
  window.__codexControlConsoleSaveDraftTodoVersion = LEGACY_SAVE;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const readThreadId = ${readNativeComposerThreadId.toString()};
  const STORE_KEY = 'codex-control-console.native-held-queue.v1';
  const VIEW_KEY = STORE_KEY + '.view';
  const DRAFT_KEY = STORE_KEY + '.recovery-draft';
  const MAX_HELD = 100;
  const HELD_ORIGINS = new Set(['draft', 'paused-queue']);
  let sequence = 0;
  let open = false;
  let busy = false;
  let serverItems = [];
  let warning = '';
  let editing = null;
  let heldView = 'manual', assignedTasks = [];
  const staleThreads = new Set();
  let activeThreadId = null;


  ${readHeldEditableText.toString()}
  ${replaceHeldEditableText.toString()} ${formatHeldInitialTime.toString()} ${orderHeldForView.toString()}
  ${createHeldDisplayRow.toString()} ${createHeldEditRow.toString()}
  ${appendAssignedChecklistTaskRows.toString()} ${normalizeAssignedChecklistTasks.toString()}
  ${resumeAssignedTask.toString()} ${updateHeldQueueShell.toString()}
  ${restoreNativeHeldDraft.toString()}
  ${reloadWithHeldDraft.toString()}
  ${summarizeNativeHeldMessage.toString()}

  const style = document.createElement('style');
  style.dataset.cccHeldQueueStyle = '';
  style.textContent = ${JSON.stringify(NATIVE_HELD_QUEUE_STYLE)};
  document.head.append(style);

  function threadId() {
    const composerId = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
    if (UUID.test(composerId)) return composerId.toLowerCase();
    return readThreadId(document);
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
  function readHeldViews() { try { const values = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); return values && typeof values === 'object' && !Array.isArray(values) ? values : {}; } catch { return {}; } }
  function readHeldView(id) { return readHeldViews()[id] === 'time' ? 'time' : 'manual'; }
  function setHeldView(id, view) { const values = readHeldViews(); values[id] = view; localStorage.setItem(VIEW_KEY, JSON.stringify(values)); heldView = view; render(); }
  function writeHeld(id, items) {
    if (items.length > MAX_HELD) throw new Error('待办消息已达 100 条，请先整理后再保存');
    const store = readStore();
    store[id] = items.filter(validHeld);
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    window.dispatchEvent(new Event('codex-control-console-held-todos-changed'));
  }
  const summarize = summarizeNativeHeldMessage;
  function request(method, params) {
    const allowed = new Set(['thread/queue/list','thread/queue/delete','thread/queue/add','thread/queue/reorder']);
    if (!allowed.has(method)) return Promise.reject(new Error('队列操作无效'));
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') return Promise.reject(new Error('原生队列桥接尚未就绪'));
    const id = 'ccc-held-queue-' + Date.now() + '-' + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error('原生队列请求超时')); }, 8000);
      const receive = (event) => {
        const data = event.data;
        if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data?.message?.id !== id) return;
        cleanup();
        if (data.message.error) reject(new Error(data.message.error.message || '原生队列请求失败'));
        else resolve(data.message.result);
      };
      const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
      window.addEventListener('message', receive);
      Promise.resolve(bridge.call(window.electronBridge, { type: 'mcp-request', hostId: 'local', retainResponse: true, request: { id, method, params } })).catch((error) => { cleanup(); reject(error); });
    });
  }
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
    try { const next = await listQueue(id); changed = queueIdentity(serverItems) !== queueIdentity(next) || Boolean(warning); serverItems = next; warning = ''; }
    catch (error) { const nextWarning = error.message || '无法读取原生队列'; changed = warning !== nextWarning; warning = nextWarning; }
    if (changed) render();
  }
  async function pauseItem(id, item, editAfterPause = false) {
    if (busy || !item?.id || item.input == null) return;
    const editableText = editAfterPause ? readHeldEditableText(item.input) : null;
    if (editAfterPause && editableText == null) { warning = '这条消息没有可安全编辑的单一文字内容'; render(); return; }
    setBusy(true);
    const before = heldFor(id);
    const held = { id: crypto.randomUUID(), input: item.input, summary: summarize(item.input), heldAt: Date.now(), origin: 'paused-queue' };
    try {
      writeHeld(id, [...before, held]);
      const result = await request('thread/queue/delete', { threadId: id, queuedSubmissionId: item.id });
      if (!result?.deleted) throw new Error('原生队列项已经变化，请先同步');
      serverItems = await listQueue(id);
      if (editAfterPause) editing = { id: held.id, value: editableText };
    } catch (error) {
      try { writeHeld(id, before); } catch {}
      warning = error.message || '暂停失败';
    } finally { setBusy(false); }
  }
  async function resumeItem(id, held) {
    if (busy) return;
    setBusy(true);
    try {
      await request('thread/queue/add', { threadId: id, input: held.input, clientUserMessageId: crypto.randomUUID() });
      writeHeld(id, heldFor(id).filter((item) => item.id !== held.id));
      serverItems = await listQueue(id);
      warning = '';
    } catch (error) { warning = error.message || '恢复失败'; }
    finally { setBusy(false); }
  }
  async function reorderServer(id, index, offset) {
    const next = index + offset;
    if (busy || next < 0 || next >= serverItems.length) return;
    setBusy(true);
    const reordered = [...serverItems]; [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    try {
      await request('thread/queue/reorder', { threadId: id, queuedSubmissionIds: reordered.map((item) => item.id) });
      serverItems = reordered; warning = '';
    } catch (error) { warning = error.message || '排序失败'; }
    finally { setBusy(false); }
  }
  function reorderHeld(id, index, offset) {
    const items = heldFor(id), next = index + offset;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]]; writeHeld(id, items); render();
  }
  function removeHeld(id, held) { writeHeld(id, heldFor(id).filter((item) => item.id !== held.id)); render(); }
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
  function draftText(editor) {
    const markdown = editor?.getAttribute?.('data-composer-markdown');
    if (typeof markdown === 'string' && markdown.trim()) return markdown.trim();
    return (editor?.textContent || '').trim();
  }
  function updateDraftButton() {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const save = document.querySelector('[data-ccc-save-draft-todo]');
    if (save) {
      const disabled = busy || !draftText(editor), opacity = disabled ? '.35' : '1', cursor = disabled ? 'default' : 'pointer';
      if (save.disabled !== disabled) save.disabled = disabled;
      if (save.style.opacity !== opacity) save.style.opacity = opacity;
      if (save.style.cursor !== cursor) save.style.cursor = cursor;
    }
  }
  function clearDraftText(editor) {
    if (!(editor instanceof HTMLElement) || !editor.isContentEditable) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    editor.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    const selectionIsInsideEditor = selection.rangeCount === 1
      && editor.contains(selection.anchorNode)
      && editor.contains(selection.focusNode)
      && editor.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (!selectionIsInsideEditor) { selection.removeAllRanges(); return false; }
    document.execCommand('delete', false, null);
    selection.removeAllRanges();
    return !draftText(editor);
  }
  function saveDraftTodo() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const text = draftText(editor);
    if (!id || !editor || !text || busy) return;
    const before = heldFor(id), input = [{ type: 'text', text }];
    try {
      writeHeld(id, [...before, { id: crypto.randomUUID(), input, summary: summarize(input), heldAt: Date.now(), origin: 'draft' }]);
      warning = clearDraftText(editor) ? '' : '待办已保存，但输入框未能自动清空；请手动清空以免重复发送。';
      open = true;
    } catch (error) { warning = error.message || '无法保存待办消息'; }
    render(); updateDraftButton();
  }
  const draftTodoButton = ${createNativeSaveDraftTodoButton.toString()}(saveDraftTodo);
  function syncNative() { reloadWithHeldDraft(threadId, draftText, DRAFT_KEY); }
  const updateShell = (id, toolbar, panel) => updateHeldQueueShell(toolbar, panel, serverItems, heldFor(id), assignedTasks, warning || staleThreads.has(id), open);
  function render() {
    const id = threadId(), toolbar = document.querySelector('[data-ccc-held-queue-button]'), panel = document.querySelector('[data-ccc-held-queue-panel]');
    if (!id || !toolbar || !panel) return;
    const held = orderHeldForView(heldFor(id), heldView);
    const stale = staleThreads.has(id);
    updateShell(id, toolbar, panel);
    panel.replaceChildren();
    const head = document.createElement('div'); head.dataset.cccHeldHead = '';
    const title = document.createElement('strong'); title.textContent = '待办';
    const state = document.createElement('span'); state.textContent = serverItems.length + ' 排队 · ' + (held.length + assignedTasks.length) + ' 待办';
    const views = document.createElement('span'); views.dataset.cccHeldViews = '';
    views.append(button('手动视图', () => setHeldView(id, 'manual'), heldView === 'manual'), button('时间视图', () => setHeldView(id, 'time'), heldView === 'time'));
    head.append(title, views, state); panel.append(head);
    if (warning || stale) { const note = document.createElement('p'); note.dataset.cccHeldWarning = ''; note.textContent = warning || '原生队列状态已经过期，当前输入仍保留；请同步后重试。'; note.append(' ', button('同步原生队列', syncNative)); panel.append(note); }
    const list = document.createElement('div'); list.dataset.cccHeldList = '';
    serverItems.forEach((item, index) => list.append(createHeldDisplayRow('排队', summarize(item.input), [
      button('编辑', () => pauseItem(id, item, true), busy), button('上移', () => reorderServer(id, index, -1), busy || index === 0), button('下移', () => reorderServer(id, index, 1), busy || index === serverItems.length - 1), button('暂停', () => pauseItem(id, item), busy)
    ])));
    held.forEach((item, index) => {
      const kind = item.origin === 'draft' ? '待办·直存' : item.origin === 'paused-queue' ? '待办·暂停' : '待办';
      if (editing?.id === item.id) { const edit = createHeldEditRow(kind, item, editing?.value || '', [button('保存', () => saveHeldEdit(id, item), busy), button('取消', cancelHeldEdit, busy)], () => { if (editing?.id === item.id) editing.value = edit.editor.value; }); list.append(edit.row); queueMicrotask(() => edit.editor.focus()); }
      else list.append(createHeldDisplayRow(kind, item.summary || summarize(item.input), [
        button('编辑', () => startHeldEdit(item), busy), button('上移', () => reorderHeld(id, index, -1), busy || heldView === 'time' || index === 0), button('下移', () => reorderHeld(id, index, 1), busy || heldView === 'time' || index === held.length - 1), button('恢复', () => resumeItem(id, item), busy), button('删除', () => removeHeld(id, item), busy)
      ], item.heldAt));
    });
    appendAssignedChecklistTaskRows(list, assignedTasks, createHeldDisplayRow, button, busy, (task) => resumeAssignedTask(task, { threadId: id, busy: () => busy, setBusy, request, removeAssigned: (taskId) => { assignedTasks = assignedTasks.filter((item) => item.id !== taskId); }, setServerItems: (items) => { serverItems = items; }, listQueue, setWarning: (value) => { warning = value; } }));
    if (!serverItems.length && !held.length && !assignedTasks.length) { const empty = document.createElement('div'); empty.dataset.cccHeldEmpty = ''; empty.textContent = '没有排队或待办'; list.append(empty); }
    panel.append(list);
  }
  const restoreDraft = () => restoreNativeHeldDraft(threadId, DRAFT_KEY);
  function install() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]'), root = editor?.closest('[data-composer-surface-variant]');
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement;
    if (!root || !host) { document.querySelector('[data-ccc-held-queue-button]')?.remove(); document.querySelector('[data-ccc-save-draft-todo]')?.remove(); document.querySelector('[data-ccc-claim-task]')?.remove(); document.querySelector('[data-ccc-held-queue-panel]')?.remove(); return; }
    ${noThread('held')}
    const threadChanged = activeThreadId !== id;
    if (threadChanged) { activeThreadId = id; serverItems = []; warning = ''; heldView = readHeldView(id); if (open) void refresh(); }
    let toolbar = document.querySelector('[data-ccc-held-queue-button]');
    if (!toolbar) { toolbar = button('待办', () => { open = !open; render(); if (open) void refresh(); }); toolbar.dataset.cccHeldQueueButton = ''; host.append(toolbar); }
    let save = document.querySelector('[data-ccc-save-draft-todo]');
    if (!save) { save = draftTodoButton(); save.dataset.cccSaveDraftTodo = ''; save.title = '把当前文字保存为待办，不加入发送队列'; save.style.cssText = 'display:inline-flex;order:1;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap'; host.insertBefore(save, toolbar); }
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
      save = draftTodoButton(); save.dataset.cccSaveDraftTodo = ''; save.title = '把当前文字保存为待办，不加入发送队列';
      save.style.cssText = 'display:inline-flex;order:1;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap';
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
    const id = threadId();
    if (id && (id !== activeThreadId || !document.querySelector('[data-ccc-held-queue-button]') || !document.querySelector('[data-ccc-held-queue-panel]'))) schedule();
    if (!document.querySelector('[data-ccc-save-draft-todo]') || !document.querySelector('[data-ccc-claim-task]')) scheduleSaveDraftTodo();
  });
  window.__codexControlConsoleHeldQueueObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  document.addEventListener('input', updateDraftButton, true);
  const removeDraftInputListener = () => document.removeEventListener('input', updateDraftButton, true);
  window.__codexControlConsoleHeldQueueInputCleanup = removeDraftInputListener;
  window.__codexControlConsoleSaveDraftTodoInputCleanup = removeDraftInputListener;
  window.__codexControlConsoleSaveDraftTodoObserver = window.__codexControlConsoleHeldQueueObserver;
  window.__codexControlConsoleHeldQueueTimer = setInterval(() => { const id = threadId();
    if (id && (id !== activeThreadId || !document.querySelector('[data-ccc-held-queue-button]') || !document.querySelector('[data-ccc-held-queue-panel]'))) install(); }, 1000);
  window.__codexControlConsoleHeldQueueRefreshTimer = setInterval(() => { if (open && !busy && !editing) void refresh(); }, 4000);
  window.__codexControlConsoleRefreshHeldQueue = refresh;
  window.__codexControlConsoleSetClaimableTaskCount = claimTasks.set;
  window.__codexControlConsoleSetAssignedChecklistTasks = (items) => {
    const next = normalizeAssignedChecklistTasks(items);
    if (JSON.stringify(next) !== JSON.stringify(assignedTasks)) { assignedTasks = next; render(); }
    return assignedTasks.length;
  };
  window.__codexControlConsoleHeldQueueVersion = LEGACY;
  window.__codexControlConsoleSaveDraftTodoVersion = LEGACY_SAVE;
  schedule(); scheduleSaveDraftTodo();
})();`;
}
