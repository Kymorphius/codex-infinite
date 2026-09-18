import { readHeldEditableText, replaceHeldEditableText } from "./held-queue-edit.mjs";
import { NATIVE_HELD_QUEUE_STYLE } from "./native-held-queue-style.mjs";

export function buildNativeComposerHeldQueueInjectionScript() {
  return `(() => {
  const VERSION = '2026-09-18.7';
  const LEGACY_RUNTIME_GUARD_VERSION = '2026-09-17.3';
  const SAVE_DRAFT_VERSION = '2026-09-18.2';
  if (window.__codexControlConsoleHeldQueueInstalledVersion === VERSION && window.__codexControlConsoleSaveDraftTodoVersion === SAVE_DRAFT_VERSION) return;
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
  window.__codexControlConsoleHeldQueueVersion = LEGACY_RUNTIME_GUARD_VERSION;
  window.__codexControlConsoleSaveDraftTodoVersion = SAVE_DRAFT_VERSION;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STORE_KEY = 'codex-control-console.native-held-queue.v1';
  const DRAFT_KEY = STORE_KEY + '.recovery-draft';
  const MAX_HELD = 100;
  const HELD_ORIGINS = new Set(['draft', 'paused-queue']);
  let sequence = 0;
  let open = false;
  let busy = false;
  let serverItems = [];
  let warning = '';
  let editing = null;
  const staleThreads = new Set();
  let activeThreadId = null;

  ${readHeldEditableText.toString()}
  ${replaceHeldEditableText.toString()}

  const style = document.createElement('style');
  style.dataset.cccHeldQueueStyle = '';
  style.textContent = ${JSON.stringify(NATIVE_HELD_QUEUE_STYLE)};
  document.head.append(style);

  function threadId() {
    const composerId = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
    if (UUID.test(composerId)) return composerId.toLowerCase();
    const value = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"]')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    const id = value.startsWith('local:') ? value.slice(6).toLowerCase() : '';
    return UUID.test(id) ? id : null;
  }
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
  function writeHeld(id, items) {
    if (items.length > MAX_HELD) throw new Error('待办消息已达 100 条，请先整理后再保存');
    const store = readStore();
    store[id] = items.filter(validHeld);
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }
  function summarize(value) {
    const found = [];
    const visit = (entry, depth = 0) => {
      if (found.length >= 4 || depth > 6 || entry == null) return;
      if (typeof entry === 'string') { const text = entry.replace(/\\s+/g, ' ').trim(); if (text && !/^data:/i.test(text) && text.length < 12000) found.push(text); return; }
      if (Array.isArray(entry)) { for (const part of entry) visit(part, depth + 1); return; }
      if (typeof entry === 'object') for (const key of ['text','prompt','content','input']) if (Object.hasOwn(entry, key)) visit(entry[key], depth + 1);
    };
    visit(value);
    return found.join(' · ').slice(0, 240) || '含附件或结构化内容的消息';
  }
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
  function draftTodoButton() {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = '存为待办';
    node.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    node.addEventListener('mousedown', (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
    node.addEventListener('click', (event) => { event.preventDefault(); event.stopImmediatePropagation(); void saveDraftTodo(); }, true);
    return node;
  }
  function setBusy(value) { busy = value; render(); }
  async function refresh() {
    const id = threadId();
    if (!id || busy) return;
    try { serverItems = await listQueue(id); warning = ''; }
    catch (error) { warning = error.message || '无法读取原生队列'; }
    render();
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
    return (editor?.innerText || editor?.textContent || '').trim();
  }
  function updateDraftButton() {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const save = document.querySelector('[data-ccc-save-draft-todo]');
    if (save) { save.disabled = busy || !draftText(editor); save.style.opacity = save.disabled ? '.35' : '1'; save.style.cursor = save.disabled ? 'default' : 'pointer'; }
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
  function syncNative() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const text = draftText(editor);
    if (id && text) localStorage.setItem(DRAFT_KEY, JSON.stringify({ threadId: id, text, savedAt: Date.now() }));
    location.reload();
  }
  function render() {
    const id = threadId(), toolbar = document.querySelector('[data-ccc-held-queue-button]'), panel = document.querySelector('[data-ccc-held-queue-panel]');
    if (!id || !toolbar || !panel) return;
    const held = heldFor(id), total = serverItems.length + held.length;
    const stale = staleThreads.has(id);
    toolbar.textContent = '待发管理 ' + total; toolbar.dataset.warning = warning || stale ? 'true' : 'false';
    panel.hidden = !open; if (!open) return;
    panel.replaceChildren();
    const head = document.createElement('div'); head.dataset.cccHeldHead = '';
    const title = document.createElement('strong'); title.textContent = '待发消息';
    const state = document.createElement('span'); state.textContent = serverItems.length + ' 排队 · ' + held.length + ' 待办';
    head.append(title, state); panel.append(head);
    if (warning || stale) { const note = document.createElement('p'); note.dataset.cccHeldWarning = ''; note.textContent = warning || '原生队列状态已经过期，当前输入仍保留；请同步后重试。'; note.append(' ', button('同步原生队列', syncNative)); panel.append(note); }
    const list = document.createElement('div'); list.dataset.cccHeldList = '';
    const appendRow = (kind, text, actions) => {
      const row = document.createElement('div'); row.dataset.cccHeldRow = '';
      const badge = document.createElement('span'); badge.dataset.cccHeldKind = ''; badge.textContent = kind;
      const content = document.createElement('span'); content.dataset.cccHeldText = ''; content.textContent = text; content.title = text;
      const controls = document.createElement('span'); controls.dataset.cccHeldActions = ''; actions.forEach((action) => controls.append(action));
      row.append(badge, content, controls); list.append(row);
    };
    const appendEditRow = (kind, held) => {
      const row = document.createElement('div'); row.dataset.cccHeldRow = ''; row.dataset.editing = 'true';
      const badge = document.createElement('span'); badge.dataset.cccHeldKind = ''; badge.textContent = kind;
      const editor = document.createElement('textarea'); editor.dataset.cccHeldEditor = ''; editor.value = editing?.value || '';
      editor.rows = 3; editor.addEventListener('input', () => { if (editing?.id === held.id) editing.value = editor.value; });
      const controls = document.createElement('span'); controls.dataset.cccHeldActions = '';
      controls.append(button('保存', () => saveHeldEdit(id, held), busy), button('取消', cancelHeldEdit, busy));
      row.append(badge, editor, controls); list.append(row); queueMicrotask(() => editor.focus());
    };
    serverItems.forEach((item, index) => appendRow('排队', summarize(item.input), [
      button('编辑', () => pauseItem(id, item, true), busy), button('上移', () => reorderServer(id, index, -1), busy || index === 0), button('下移', () => reorderServer(id, index, 1), busy || index === serverItems.length - 1), button('暂停', () => pauseItem(id, item), busy)
    ]));
    held.forEach((item, index) => {
      const kind = item.origin === 'draft' ? '待办·直存' : item.origin === 'paused-queue' ? '待办·暂停' : '待办';
      if (editing?.id === item.id) appendEditRow(kind, item);
      else appendRow(kind, item.summary || summarize(item.input), [
        button('编辑', () => startHeldEdit(item), busy), button('上移', () => reorderHeld(id, index, -1), busy || index === 0), button('下移', () => reorderHeld(id, index, 1), busy || index === held.length - 1), button('恢复', () => resumeItem(id, item), busy), button('删除', () => removeHeld(id, item), busy)
      ]);
    });
    if (!serverItems.length && !held.length) { const empty = document.createElement('div'); empty.dataset.cccHeldEmpty = ''; empty.textContent = '没有排队或待办消息'; list.append(empty); }
    panel.append(list);
  }
  function restoreDraft() {
    const id = threadId(); if (!id) return;
    let saved; try { saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
    if (!saved || saved.threadId !== id || Date.now() - saved.savedAt > 300000) return;
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    if (!editor || (editor.innerText || editor.textContent || '').trim()) return;
    editor.focus(); document.execCommand('insertText', false, String(saved.text || '')); localStorage.removeItem(DRAFT_KEY);
  }
  function install() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]'), root = editor?.closest('[data-composer-surface-variant]');
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement;
    if (!id || !root || !host) { document.querySelector('[data-ccc-held-queue-button]')?.remove(); document.querySelector('[data-ccc-save-draft-todo]')?.remove(); document.querySelector('[data-ccc-held-queue-panel]')?.remove(); return; }
    if (activeThreadId !== id) { activeThreadId = id; serverItems = []; warning = ''; if (open) void refresh(); }
    let toolbar = document.querySelector('[data-ccc-held-queue-button]');
    if (!toolbar) { toolbar = button('待发管理', () => { open = !open; render(); if (open) void refresh(); }); toolbar.dataset.cccHeldQueueButton = ''; host.append(toolbar); }
    let save = document.querySelector('[data-ccc-save-draft-todo]');
    if (!save) { save = draftTodoButton(); save.dataset.cccSaveDraftTodo = ''; save.title = '把当前文字保存为待办，不加入发送队列'; save.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap'; host.insertBefore(save, toolbar); }
    let panel = document.querySelector('[data-ccc-held-queue-panel]');
    if (!panel) { panel = document.createElement('section'); panel.dataset.cccHeldQueuePanel = ''; panel.hidden = true; root.prepend(panel); }
    restoreDraft(); render(); updateDraftButton();
  }
  function installSaveDraftTodo() {
    const id = threadId(), editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const permission = document.querySelector('[data-composer-navigation-target="permissions"]'), host = permission?.parentElement;
    if (!id || !editor || !host) { document.querySelector('[data-ccc-save-draft-todo]')?.remove(); return; }
    let save = document.querySelector('[data-ccc-save-draft-todo]');
    if (!save) {
      save = draftTodoButton(); save.dataset.cccSaveDraftTodo = ''; save.title = '把当前文字保存为待办，不加入发送队列';
      save.style.cssText = 'display:inline-flex;align-items:center;height:28px;padding:0 9px;border:1px solid rgba(128,128,128,.25);border-radius:999px;background:transparent;color:currentColor;font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap';
      const manager = document.querySelector('[data-ccc-held-queue-button]');
      host.insertBefore(save, manager?.parentElement === host ? manager : null);
    }
    updateDraftButton();
  }
  let installTimer = null;
  function schedule() { clearTimeout(installTimer); installTimer = setTimeout(install, 50); }
  let saveDraftInstallTimer = null;
  function scheduleSaveDraftTodo() { clearTimeout(saveDraftInstallTimer); saveDraftInstallTimer = setTimeout(installSaveDraftTodo, 50); }
  function containsStaleQueueAlert(node) {
    if (node?.nodeType !== 1) return false;
    const notices = node.matches?.('[role="alert"],[data-sonner-toast]') ? [node] : [...(node.querySelectorAll?.('[role="alert"],[data-sonner-toast]') || [])];
    return notices.some((notice) => /App-server queued follow-up no longer exists/i.test(notice.textContent || ''));
  }
  window.__codexControlConsoleHeldQueueObserver = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes].some(containsStaleQueueAlert))) { const id = threadId(); if (id) staleThreads.add(id); open = true; render(); }
    schedule();
  });
  window.__codexControlConsoleHeldQueueObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  document.addEventListener('input', updateDraftButton, true);
  window.__codexControlConsoleHeldQueueInputCleanup = () => document.removeEventListener('input', updateDraftButton, true);
  window.__codexControlConsoleSaveDraftTodoObserver = new MutationObserver(scheduleSaveDraftTodo);
  window.__codexControlConsoleSaveDraftTodoObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current'] });
  const updateIndependentDraftButton = () => updateDraftButton();
  document.addEventListener('input', updateIndependentDraftButton, true);
  window.__codexControlConsoleSaveDraftTodoInputCleanup = () => document.removeEventListener('input', updateIndependentDraftButton, true);
  window.__codexControlConsoleHeldQueueTimer = setInterval(() => {
    if (!document.querySelector('[data-ccc-held-queue-button]') || !document.querySelector('[data-ccc-held-queue-panel]')) install();
  }, 1000);
  window.__codexControlConsoleHeldQueueRefreshTimer = setInterval(() => { if (open && !busy && !editing) void refresh(); }, 4000);
  window.__codexControlConsoleRefreshHeldQueue = refresh;
  window.__codexControlConsoleHeldQueueVersion = LEGACY_RUNTIME_GUARD_VERSION;
  schedule(); scheduleSaveDraftTodo();
})();`;
}
