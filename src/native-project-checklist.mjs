import { readNativeChecklistHeldTodos } from './native-checklist-held-todos.mjs';
import { readNativeChecklistConversationChoices } from './native-checklist-conversation-choices.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { createChecklistReturnBridge } from './native-checklist-return.mjs';

export function installNativeProjectChecklist(readHeldTodos = () => [], readConversationChoices = () => [], readThreadId = () => null, createReturns) {
  const VERSION = '2026-09-22.3', KEY = 'ccc.project-checklist.pending.v1', GENERAL_KEY = 'ccc:general-inbox:v1';
  if (window.__cccProjectChecklist?.version === VERSION) return;
  window.__cccProjectChecklist?.dispose();
  let project = null, items = [], generalItems = [], generalLoaded = false, held = [], heldLoaded = false, heldLoadScheduled = false, loaded = '', pending = [], error = '', storageError = '', renderVersion = 0;
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) pending = saved; }
  catch { storageError = '无法读取待保存任务，请勿关闭窗口'; }
  const make = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const style = make('style'); style.textContent = `
    [data-ccc-checklist]{position:fixed;inset:0;margin:auto;width:min(600px,calc(100vw - 48px));max-height:80vh;padding:24px;border:1px solid #8885;border-radius:16px;background:var(--color-background-primary,#252525);color:var(--color-text,#eee);box-shadow:0 20px 80px #0006;font:14px/1.5 system-ui}
    [data-ccc-checklist]::backdrop{background:#0006}
    [data-ccc-checklist] header{display:flex;align-items:center;justify-content:space-between;gap:16px}
    [data-ccc-checklist] h2{font-size:18px;margin:0}[data-ccc-checklist] p{color:#999;margin:6px 0 18px;overflow-wrap:anywhere}
    [data-ccc-checklist] button{cursor:pointer;border:1px solid #8885;border-radius:7px;padding:5px 10px;background:transparent;color:inherit}
    [data-ccc-checklist] select{min-width:150px;max-width:240px;border:1px solid #8885;border-radius:7px;padding:5px 8px;background:var(--color-background-primary,#252525);color:inherit}
    [data-ccc-checklist] form{display:flex;gap:8px;margin:16px 0}
    [data-ccc-checklist] input[type=text]{min-width:0;flex:1;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;padding:8px}
    [data-ccc-checklist] ul{list-style:none;padding:0;margin:12px 0;max-height:45vh;overflow:auto}
    [data-ccc-checklist] li{display:flex;align-items:center;gap:10px;padding:6px 0}
    [data-ccc-checklist] li[data-done=true] input[type=text]{text-decoration:line-through;opacity:.55}
    [data-ccc-checklist] li[data-ccc-held-todo]{align-items:flex-start;padding:8px;border-radius:8px;background:#8881}[data-ccc-checklist] li[data-ccc-held-todo] input{flex:1}[data-ccc-checklist] li[data-ccc-held-todo] small{margin-inline-end:auto}
    [data-ccc-checklist] small{display:block;color:#999}[data-ccc-checklist] button:disabled{opacity:.4;cursor:default}
  `;
  const dialog = make('dialog'); dialog.setAttribute('data-ccc-checklist', ''); dialog.setAttribute('aria-label', '项目任务清单');
  const header = make('header'), title = make('h2', '任务清单'), close = make('button', '关闭'); header.append(title, close);
  const subtitle = make('p'), form = make('form'), input = make('input'), add = make('button', '添加');
  input.type = 'text'; input.maxLength = 5000; input.placeholder = '想在这个项目里做什么？'; input.setAttribute('aria-label', '新任务'); add.type = 'submit'; form.append(input, add);
  const count = make('small'), list = make('ul'), status = make('small'); status.setAttribute('role', 'status');
  dialog.append(header, subtitle, form, count, list, status, make('small', '保存在本机 · 勾选记录完成状态'));
  document.head.append(style); document.body.append(dialog);
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(pending)); storageError = ''; } catch { storageError = '任务尚未保存到草稿，请勿关闭窗口'; } }
  function view(projectKey = project?.key, source = items) {
    const result = source.map(item => ({ id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null }));
    for (const action of pending.filter(value => value.projectKey === projectKey)) {
      const index = result.findIndex(item => item.id === action.id);
      if (action.type === 'delete') { if (index >= 0) result.splice(index, 1); }
      else { const item = { id: action.id, text: action.text, done: action.done, assignedThreadId: action.assignedThreadId || null }; if (index >= 0) result[index] = item; else result.push(item); }
    }
    return result;
  }
  function state() {
    const busy = pending.some(action => action.projectKey === project?.key);
    status.textContent = storageError || error || (busy ? '正在保存…' : loaded === project?.key ? '已保存' : '正在读取…');
    input.disabled = add.disabled = loaded !== project?.key;
  }
  function act(type, item, projectKey = project.key) {
    pending.push({ projectKey, type, id: item.id, text: item.text, done: item.done, assignedThreadId: item.assignedThreadId || null, requestId: crypto.randomUUID() });
    persist(); render();
  }
  function appendAssignmentControl(row, item, label) {
    const assign = make('button', label); assign.disabled = loaded !== project?.key;
    assign.addEventListener('click', () => {
      const choices = readConversationChoices(document);
      if (!choices.length) { error = '暂时没有可指派的本机会话'; state(); return; }
      const select = make('select'), confirm = make('button', '确认'), cancel = make('button', '取消');
      select.setAttribute('aria-label', '选择指派会话'); const none = make('option', '不指派'); none.value = ''; select.append(none);
      for (const choice of choices) { const option = make('option', choice.title || choice.id); option.value = choice.id; option.selected = choice.id === item.assignedThreadId; select.append(option); }
      confirm.addEventListener('click', () => act('upsert', { ...item, assignedThreadId: select.value || null }));
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
  function render() {
    const version = ++renderVersion;
    state(); list.replaceChildren(); const values = view(), projectedHeld = project?.general ? held : [];
    const assigned = project?.general && !project.claimThreadId ? values.filter(item => !item.done && item.assignedThreadId) : [];
    const visible = project?.claimThreadId ? values.filter(item => !item.done && !item.assignedThreadId) : project?.general ? values.filter(item => !item.assignedThreadId) : values;
    count.textContent = project?.general ? `${visible.filter(item => !item.done).length} 项未指派 · ${values.filter(item => item.done).length} 项已完成 · ${heldLoaded ? assigned.length + projectedHeld.length + ' 项会话待办' : '正在加载会话待办…'}` : `${values.filter(item => !item.done).length} 项待办 · ${values.filter(item => item.done).length} 项已完成`;
    if (!visible.length && !assigned.length && (!heldLoaded || !projectedHeld.length)) list.append(make('li', loaded === project?.key ? (project?.general && !heldLoaded ? '正在加载会话待办…' : '还没有任务，先记下一件想做的事。') : '正在读取清单…'));
    for (const item of visible) {
      const row = make('li'), check = make('input'), text = make('input'), remove = make('button', '删除');
      row.dataset.done = String(item.done); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '完成：' + item.text);
      text.type = 'text'; text.value = item.text; text.maxLength = 5000; text.setAttribute('aria-label', '任务内容');
      check.disabled = text.disabled = remove.disabled = loaded !== project?.key;
      if (project?.claimThreadId) {
        const projectKey = project.key, targetThreadId = project.claimThreadId, taskId = item.id, taskText = item.text;
        const claim = make('button', '领取'); check.remove(); remove.remove(); text.disabled = true; claim.disabled = loaded !== project?.key;
        claim.addEventListener('click', () => {
          if (version !== renderVersion || project?.key !== projectKey || project.claimThreadId !== targetThreadId || loaded !== projectKey) return;
          const current = view(projectKey, generalItems).find(value => value.id === taskId && value.text === taskText && !value.done && !value.assignedThreadId);
          if (current) act('upsert', { ...current, assignedThreadId: targetThreadId }, projectKey);
        }); row.append(text, claim); list.append(row); continue;
      }
      check.addEventListener('change', () => act('upsert', { ...item, done: check.checked }));
      text.addEventListener('change', () => { if (text.value.trim()) act('upsert', { ...item, text: text.value.trim() }); else text.value = item.text; });
      remove.addEventListener('click', () => act('delete', item)); row.append(check, text);
      if (project?.general) appendAssignmentControl(row, item, '指派会话');
      row.append(remove); list.append(row);
    }
    for (const item of assigned) {
      const row = make('li'), source = make('small', '会话待办'), text = make('input'); row.setAttribute('data-ccc-held-todo', '');
      text.type = 'text'; text.value = item.text; text.disabled = true; row.append(source, text); appendAssignmentControl(row, item, '改派会话'); list.append(row);
    }
    for (const item of projectedHeld) {
      const row = make('li'), source = make('small', item.origin), text = make('input'), open = make('button', '打开会话');
      row.setAttribute('data-ccc-held-todo', ''); text.type = 'text'; text.value = item.text; text.disabled = true; text.title = '会话待办保存在原会话中；打开后可编辑、删除或手动恢复发送。';
      open.addEventListener('click', () => {
        const openNativeThread = window.__codexControlConsoleOpenNativeThread;
        if (typeof openNativeThread === 'function') void openNativeThread(item.threadId).catch(() => {});
        else window.postMessage({ type: 'navigate-to-route', path: '/local/' + encodeURIComponent(item.threadId) }, '*');
        dialog.close();
      });
      row.append(source, text, open); list.append(row);
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (input.value.trim() && loaded === project?.key) { act('upsert', { id: crypto.randomUUID(), text: input.value.trim(), done: false }); input.value = ''; input.focus(); } });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.__cccProjectChecklist = { version: VERSION,
    returnAssignedTask: returns.returnAssignedTask,
    openGeneral() { this.open({ key: 'ccc:general-inbox:v1', general: true, name: '先记下想做的事，之后再确定归属。未指派任务可分给会话；会话待办也会显示在这里。' }); },
    openClaimableForCurrentThread(threadId) { this.open({ key: 'ccc:general-inbox:v1', general: true, claimThreadId: threadId, name: '选择一项未指派的综合任务领取到当前会话。领取不会发送消息。' }); },
    completeAssignedTask(id, threadId, text) {
      if (!threadId || typeof text !== 'string') return false;
      const item = view(GENERAL_KEY, generalItems).find(value => value.id === id && !value.done && value.assignedThreadId === threadId && value.text === text);
      if (!item) return false;
      act('upsert', { ...item, done: true }, GENERAL_KEY); return true;
    },
    open(value) { title.textContent = value.general ? '综合任务清单' : '任务清单'; dialog.setAttribute('aria-label', value.general ? '综合任务清单' : '项目任务清单'); input.placeholder = value.general ? '有什么想做的？先记在这里…' : '想在这个项目里做什么？'; project = value; items = value.general && generalLoaded ? generalItems : []; held = []; heldLoaded = !value.general; loaded = value.general && generalLoaded ? value.key : ''; error = ''; subtitle.textContent = value.name || value.id; input.value = ''; render(); if (!dialog.open) dialog.showModal(); if (value.general) scheduleHeldLoad(); },
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
  function loadHeldTodos() { heldLoadScheduled = false; if (!project?.general) return; held = readHeldTodos(localStorage); heldLoaded = true; render(); }
  function scheduleHeldLoad() { if (heldLoadScheduled || heldLoaded || !project?.general) return; heldLoadScheduled = true; if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(loadHeldTodos, { timeout: 1000 }); else if (typeof setTimeout === 'function') setTimeout(loadHeldTodos, 0); else heldLoadScheduled = false; }
  function refreshHeldTodos() { if (project?.general) { heldLoaded = false; scheduleHeldLoad(); render(); } }
  window.addEventListener('codex-control-console-held-todos-changed', refreshHeldTodos);
}
export function buildNativeProjectChecklistScript() { return `(${installNativeProjectChecklist.toString()})(${readNativeChecklistHeldTodos.toString()},${readNativeChecklistConversationChoices.toString()},${readNativeComposerThreadId.toString()},${createChecklistReturnBridge.toString()});`; }
