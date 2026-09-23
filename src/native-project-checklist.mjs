import { readNativeChecklistHeldTodos } from './native-checklist-held-todos.mjs';
import { readNativeChecklistConversationChoices } from './native-checklist-conversation-choices.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { createChecklistReturnBridge } from './native-checklist-return.mjs';
import { checklistTimeMetadata } from './project-checklist-time.mjs';
import { createChecklistTimePresentation } from './checklist-time-presentation.mjs';
import { createChecklistTaskEditor } from './native-checklist-task-editor.mjs';
import { createChecklistSearch } from './native-checklist-search.mjs';
import { createNativeChecklistThreadStarter, createNativeChecklistNewThreadClaim } from './native-checklist-new-thread-claim.mjs';

export function installNativeProjectChecklist(readHeldTodos = () => [], readConversationChoices = () => [], readThreadId = () => null, createReturns, readTime, createTimePresentation, createTaskEditor, createSearch, createThreadStarter, createNewThreadClaim) {
  const VERSION = '2026-09-23.claim-layout10', KEY = 'ccc.project-checklist.pending.v1', GENERAL_KEY = 'ccc:general-inbox:v1';
  if (window.__cccProjectChecklist?.version === VERSION) return;
  window.__cccProjectChecklist?.dispose();
  let project = null, items = [], generalItems = [], generalLoaded = false, held = [], heldLoaded = false, heldLoadScheduled = false, loaded = '', pending = [], error = '', claimWarning = '', storageError = '', renderVersion = 0;
  const taskEditors = new Map();
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) pending = saved; }
  catch { storageError = '无法读取待保存任务，请勿关闭窗口'; }
  const make = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const time = createTimePresentation(readTime);
  const search = createSearch(make);
  const icon = body => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>') + '")';
  const addIcon = icon('<path d="M12 5v14M5 12h14"/>');
  const searchIcon = icon('<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>');
  const style = make('style'); style.textContent = `
    [data-ccc-checklist]{position:fixed;inset:0;margin:auto;width:min(760px,calc(100vw - 40px));max-height:82vh;padding:22px;border:1px solid #8885;border-radius:18px;background:var(--color-background-primary,#252525);color:var(--color-text,#eee);box-shadow:0 24px 80px #0008;font:14px/1.5 system-ui}
    [data-ccc-checklist]::backdrop{background:#0006}
    [data-ccc-checklist][open]{display:flex;flex-direction:column;gap:10px}
    [data-ccc-checklist] header{display:flex;align-items:center;justify-content:space-between;gap:16px;order:0}
    [data-ccc-checklist] [data-checklist-controls]{display:contents}
    [data-ccc-checklist] [data-checklist-controls] p{order:1}
    [data-ccc-checklist] form{order:2}[data-ccc-checklist] [data-checklist-search]{order:3}
    [data-ccc-checklist] > :not(header):not(form):not([data-checklist-controls]){order:4}
    [data-ccc-checklist] form,[data-ccc-checklist] [data-checklist-search]{display:flex;align-items:center;gap:8px;padding:5px 8px;border:0;border-radius:11px;background:#8881;min-height:38px}
    [data-ccc-checklist] form:focus-within,[data-ccc-checklist] [data-checklist-search]:focus-within{outline:1px solid #aaa8}
    [data-ccc-checklist] form::before,[data-ccc-checklist] [data-checklist-search]::before{content:'';flex:none;width:18px;height:18px;background:var(--color-text-secondary,#aaa)}
    [data-ccc-checklist] form::before{-webkit-mask:${addIcon} center/contain no-repeat;mask:${addIcon} center/contain no-repeat}
    [data-ccc-checklist] [data-checklist-search]::before{-webkit-mask:${searchIcon} center/contain no-repeat;mask:${searchIcon} center/contain no-repeat}
    [data-ccc-checklist] [data-checklist-search] small{white-space:nowrap}[data-ccc-checklist] [hidden]{display:none}
    [data-ccc-checklist] h2{font-size:18px;margin:0;font-weight:650}[data-ccc-checklist] p{color:#aaa;margin:0;overflow-wrap:anywhere}
    [data-ccc-checklist] button{cursor:pointer;border:0;border-radius:8px;padding:5px 10px;background:#8882;color:inherit}
    [data-ccc-checklist] button:hover{background:#8883}
    [data-ccc-checklist] select{min-width:150px;max-width:240px;border:0;border-radius:7px;padding:5px 8px;background:#8882;color:inherit}
    [data-ccc-checklist] input[type=text],[data-ccc-checklist] input[type=search],[data-ccc-checklist] textarea{min-width:0;flex:1;border:0;border-radius:7px;background:#8881;color:inherit;padding:8px}
    [data-ccc-checklist] form input,[data-ccc-checklist] [data-checklist-search] input{border:0;background:transparent;outline:0;padding:4px 2px}
    [data-ccc-checklist] form button{background:#8882}
    [data-ccc-checklist] textarea{font:inherit;line-height:1.4;field-sizing:content;min-height:34px;max-height:128px;overflow-y:auto;resize:vertical;padding:5px 8px;background:transparent}
    [data-ccc-checklist] textarea:focus-visible{outline:1px solid #aaa8;background:#8881}
    [data-ccc-checklist] ul{list-style:none;padding:0;padding-inline-start:48px;margin:2px 0;max-height:45vh;overflow:auto;display:flex;flex-direction:column;gap:5px;counter-reset:task}
    [data-ccc-checklist] li{display:flex;align-items:center;gap:4px 10px;padding:7px 9px;flex-wrap:wrap;border:0;border-radius:10px;background:#8881}
    [data-ccc-checklist] li[data-checklist-row]{counter-increment:task;position:relative}
    [data-ccc-checklist] li[data-checklist-row]::before{content:counter(task) '.';position:absolute;inset-inline-start:-44px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:32px;height:34px;border-radius:9px;background:#8882;font-size:11px;font-variant-numeric:tabular-nums;color:#aaa}
    [data-ccc-checklist] li textarea{min-width:min(220px,100%)}
    [data-ccc-checklist] [data-checklist-added]{order:-1;flex:none;margin-inline-end:8px;white-space:nowrap;font-size:11px;color:#999;line-height:1.2}
    [data-ccc-checklist] li[data-done=true] textarea{text-decoration:line-through;opacity:.55}
    [data-ccc-checklist] li[data-ccc-held-todo]{align-items:flex-start;background:#8882}[data-ccc-checklist] li[data-ccc-held-todo] input{flex:1}[data-ccc-checklist] li[data-ccc-held-todo] small{margin-inline-end:auto}
    [data-ccc-checklist] [data-checklist-count]{padding-top:5px;font-size:12px}
    [data-ccc-checklist] small{display:block;color:#999}[data-ccc-checklist] button:disabled{opacity:.4;cursor:default}
  `;
  const dialog = make('dialog'); dialog.setAttribute('data-ccc-checklist', ''); dialog.setAttribute('aria-label', '项目任务清单');
  const header = make('header'), title = make('h2', '任务清单'), close = make('button', '关闭'); header.append(title, close);
  const subtitle = make('div'), description = make('p'), form = make('form'), input = make('input'), add = make('button', '添加');
  subtitle.setAttribute('data-checklist-controls', ''); subtitle.append(description, search.root);
  input.type = 'text'; input.maxLength = 5000; input.placeholder = '想在这个项目里做什么？'; input.setAttribute('aria-label', '新任务'); add.type = 'submit'; form.append(input, add);
  const count = make('small'), list = make('ul'), status = make('small'); count.setAttribute('data-checklist-count', ''); status.setAttribute('role', 'status');
  dialog.append(header, subtitle, form, count, list, status, make('small', '保存在本机 · 按加入时间从早到晚 · 勾选记录完成状态'));
  document.head.append(style); document.body.append(dialog);
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(pending)); storageError = ''; } catch { storageError = '任务尚未保存到草稿，请勿关闭窗口'; } }
  function view(projectKey = project?.key, source = items) {
    const result = source.map(item => ({ id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null, ...readTime(item) }));
    for (const action of pending.filter(value => value.projectKey === projectKey)) {
      const index = result.findIndex(item => item.id === action.id);
      if (action.type === 'delete') { if (index >= 0) result.splice(index, 1); }
      else { const item = { id: action.id, text: action.text, done: action.done, assignedThreadId: action.assignedThreadId || null, ...readTime(index >= 0 ? result[index] : action) }; if (index >= 0) result[index] = item; else result.push(item); }
    }
    return result;
  }
  function state() {
    const busy = pending.some(action => action.projectKey === project?.key);
    status.textContent = storageError || claimWarning || error || (busy ? '正在保存…' : loaded === project?.key ? '已保存' : '正在读取…');
    input.disabled = add.disabled = loaded !== project?.key;
  }
  function act(type, item, projectKey = project.key, refresh = true) {
    const requestId = crypto.randomUUID();
    pending.push({ projectKey, type, id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null, ...(item.createdAt ? readTime(item) : {}), requestId });
    persist(); if (refresh) render(); else state();
    return requestId;
  }
  function appendAssignmentControl(row, item, label, readTask) {
    const assign = make('button', label); assign.disabled = loaded !== project?.key;
    const projectKey = project?.key, panelVersion = renderVersion;
    const current = () => {
      if (!dialog.open || project?.key !== projectKey || panelVersion !== renderVersion || loaded !== projectKey) return null;
      return readTask ? readTask() : view(projectKey, generalItems).find(value => value.id === item.id && value.text === item.text && value.done === item.done && value.assignedThreadId === item.assignedThreadId);
    };
    assign.addEventListener('pointerdown', event => event.preventDefault());
    assign.addEventListener('click', () => {
      if (!current()) return;
      const choices = readConversationChoices(document);
      if (!choices.length) { error = '暂时没有可指派的本机会话'; state(); return; }
      const select = make('select'), confirm = make('button', '确认'), cancel = make('button', '取消');
      select.setAttribute('aria-label', '选择指派会话'); const none = make('option', '不指派'); none.value = ''; select.append(none);
      for (const choice of choices) { const option = make('option', choice.title || choice.id); option.value = choice.id; option.selected = choice.id === item.assignedThreadId; select.append(option); }
      confirm.addEventListener('pointerdown', event => event.preventDefault());
      confirm.addEventListener('click', () => { const value = current(); if (value) act('upsert', { ...value, assignedThreadId: select.value || null }, projectKey); });
      cancel.addEventListener('click', render); assign.replaceWith(select, confirm, cancel);
    }); row.append(assign);
  }
  const returns = createReturns({
    readItems: () => view(GENERAL_KEY, generalItems), readThreadId: () => readThreadId(document),
    enqueue(action) {
      pending.push(action); persist();
      if (storageError) { pending = pending.filter(value => value.requestId !== action.requestId); throw new Error(storageError); }
      render();
    }
  });
  const newThreadClaim = createNewThreadClaim({
    start: createThreadStarter(),
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
    state(); list.replaceChildren(); const values = time.order(view()), claiming = Boolean(project?.claimThreadId || project?.claimNewThread), projectedHeld = project?.general && !claiming ? held : [];
    const assigned = project?.general && !claiming ? values.filter(item => !item.done && item.assignedThreadId) : [];
    const visible = claiming ? values.filter(item => !item.done && !item.assignedThreadId) : project?.general ? values.filter(item => !item.assignedThreadId) : values;
    count.textContent = project?.general ? `${visible.filter(item => !item.done).length} 项未指派 · ${values.filter(item => item.done).length} 项已完成 · ${heldLoaded ? assigned.length + projectedHeld.length + ' 项会话待办' : '正在加载会话待办…'}` : `${values.filter(item => !item.done).length} 项待办 · ${values.filter(item => item.done).length} 项已完成`;
    if (!visible.length && !assigned.length && (!heldLoaded || !projectedHeld.length)) list.append(make('li', loaded === project?.key ? (project?.general && !heldLoaded ? '正在加载会话待办…' : '还没有任务，先记下一件想做的事。') : '正在读取清单…'));
    for (const item of visible) {
      const row = make('li'), check = make('input'), text = make('textarea'), remove = make('button', '删除');
      row.setAttribute('data-checklist-row', '');
      row.dataset.done = String(item.done); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '完成：' + item.text);
      check.disabled = text.disabled = remove.disabled = loaded !== project?.key;
      const projectKey = project.key, targetThreadId = project.claimThreadId, newThread = Boolean(project.claimNewThread), taskId = item.id;
      const currentPanel = () => dialog.open && version === renderVersion && project?.key === projectKey && project.claimThreadId === targetThreadId && Boolean(project.claimNewThread) === newThread && loaded === projectKey;
      const editor = createTaskEditor({ text, item, draft: drafts.get(taskId), disabled: loaded !== projectKey,
        readCurrent: expectedText => {
          if (!currentPanel()) return;
          return view(projectKey, project.general ? generalItems : items).find(value => value.id === taskId && value.text === expectedText && value.done === item.done && value.assignedThreadId === item.assignedThreadId);
        },
        onSave: current => act('upsert', current, projectKey, false),
        onError: message => { if (currentPanel()) { error = message; state(); } }
      }); taskEditors.set(taskId, editor);
      if (claiming) {
        const claim = make('button', '领取'); claim.type = 'button'; claim.disabled = loaded !== projectKey;
        claim.title = newThread ? '把当前框内的内容放入新任务输入框并发送，创建新会话' : '领取当前框内的内容到会话待办，保持暂停，不自动发送';
        claim.addEventListener('pointerdown', event => event.preventDefault());
        claim.addEventListener('click', () => {
          if (newThread) void newThreadClaim.claim(taskId, editor.read);
          else { const current = editor.read(); if (current) act('upsert', { ...current, assignedThreadId: targetThreadId }, projectKey); }
        });
        row.append(text, claim);
      } else {
        check.addEventListener('change', () => { const current = editor.read(); if (current) act('upsert', { ...current, done: check.checked }, projectKey); });
        remove.addEventListener('click', () => { const current = editor.current(); if (current) act('delete', current, projectKey); }); row.append(check, text);
        if (project?.general) appendAssignmentControl(row, item, '指派会话', editor.read);
        row.append(remove);
      }
      appendTime(row, item); list.append(row); editor.restoreFocus(); search.register(row, () => text.value);
    }
    for (const item of time.order([...assigned.map(value => ({ ...value, assignedChecklist: true })), ...projectedHeld])) {
      const row = make('li'), source = make('small', item.assignedChecklist ? '会话待办' : item.origin), text = make('input'), open = make('button', '打开会话');
      row.setAttribute('data-checklist-row', '');
      row.setAttribute('data-ccc-held-todo', ''); text.type = 'text'; text.value = item.text; text.disabled = true; text.title = '会话待办保存在原会话中；打开后可编辑、删除或手动恢复发送。';
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
  }
  function appendTime(row, item) { const detail = time.describe(item), stamp = make('time', detail.label); stamp.setAttribute('data-checklist-added', ''); if (detail.dateTime) stamp.setAttribute('datetime', detail.dateTime); stamp.title = detail.title; row.append(stamp); }
  form.addEventListener('submit', event => { event.preventDefault(); if (input.value.trim() && loaded === project?.key) { act('upsert', { id: crypto.randomUUID(), text: input.value.trim(), done: false, createdAt: new Date().toISOString() }); input.value = ''; input.focus(); } });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.__cccProjectChecklist = { version: VERSION,
    returnAssignedTask: returns.returnAssignedTask,
    openGeneral() { this.open({ key: 'ccc:general-inbox:v1', general: true, name: '先记下想做的事，之后再确定归属。未指派任务可分给会话；会话待办也会显示在这里。' }); },
    openClaimableForCurrentThread(threadId) { this.open({ key: 'ccc:general-inbox:v1', general: true, claimThreadId: threadId, name: '直接编辑任务内容；领取时使用框内最新内容，放入当前会话待办并保持暂停。领取不会发送消息。' }); },
    openClaimableForNewThread() { this.open({ key: GENERAL_KEY, general: true, claimNewThread: true, name: '直接编辑任务内容；点击领取会填入新任务输入框并发送，创建新会话。' }); },
    completeAssignedTask(id, threadId, text) {
      if (!threadId || typeof text !== 'string') return false;
      const item = view(GENERAL_KEY, generalItems).find(value => value.id === id && !value.done && value.assignedThreadId === threadId && value.text === text);
      if (!item) return false;
      act('upsert', { ...item, done: true }, GENERAL_KEY); return true;
    },
    open(value) { title.textContent = value.general ? '综合任务清单' : '任务清单'; dialog.setAttribute('aria-label', value.general ? '综合任务清单' : '项目任务清单'); input.placeholder = value.general ? '有什么想做的？先记在这里…' : '想在这个项目里做什么？'; taskEditors.clear(); search.reset(); project = value; items = value.general && generalLoaded ? generalItems : []; held = []; heldLoaded = !value.general || !!value.claimThreadId || !!value.claimNewThread; form.hidden = Boolean(value.claimThreadId || value.claimNewThread); dialog.dataset.claim = String(form.hidden); loaded = value.general && generalLoaded ? value.key : ''; error = ''; claimWarning = ''; description.textContent = value.name || value.id; input.value = ''; render(); if (!dialog.open) dialog.showModal(); if (value.general) scheduleHeldLoad(); },
    cacheGeneral(nextItems) { if (!Array.isArray(nextItems)) return; generalItems = nextItems; generalLoaded = true; if (project?.key === 'ccc:general-inbox:v1' && loaded !== project.key) { items = generalItems; loaded = project.key; render(); } },
    packet() { return { projectKey: project?.key || '', actions: pending.slice(0, 20) }; },
    accept(result) {
      const before = JSON.stringify(view());
      pending = pending.filter(action => !result.acknowledged.includes(action.requestId)); persist(); error = result.error || '';
      const first = loaded !== project?.key;
      if (result.projectKey === project?.key && Array.isArray(result.items)) { items = result.items; loaded = result.projectKey; if (result.projectKey === 'ccc:general-inbox:v1') { generalItems = result.items; generalLoaded = true; } }
      if (first || before !== JSON.stringify(view())) render(); else state();
      returns.accept(result);
    },
    dispose() { returns.dispose(); window.removeEventListener('codex-control-console-held-todos-changed', refreshHeldTodos); dialog.remove(); style.remove(); }
  };
  function loadHeldTodos() { heldLoadScheduled = false; if (!project?.general || project.claimThreadId || project.claimNewThread) return; held = readHeldTodos(localStorage); heldLoaded = true; render(); }
  function scheduleHeldLoad() { if (heldLoadScheduled || heldLoaded || !project?.general || project.claimThreadId || project.claimNewThread) return; heldLoadScheduled = true; if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(loadHeldTodos, { timeout: 1000 }); else if (typeof setTimeout === 'function') setTimeout(loadHeldTodos, 0); else heldLoadScheduled = false; }
  function refreshHeldTodos() { if (project?.general && !project.claimThreadId && !project.claimNewThread) { heldLoaded = false; scheduleHeldLoad(); render(); } }
  window.addEventListener('codex-control-console-held-todos-changed', refreshHeldTodos);
}
export function buildNativeProjectChecklistScript() { return `${createNativeChecklistThreadStarter.toString()}\n${createNativeChecklistNewThreadClaim.toString()}\n(${installNativeProjectChecklist.toString()})(${readNativeChecklistHeldTodos.toString()},${readNativeChecklistConversationChoices.toString()},${readNativeComposerThreadId.toString()},${createChecklistReturnBridge.toString()},${checklistTimeMetadata.toString()},${createChecklistTimePresentation.toString()},${createChecklistTaskEditor.toString()},${createChecklistSearch.toString()},createNativeChecklistThreadStarter,createNativeChecklistNewThreadClaim);`; }
