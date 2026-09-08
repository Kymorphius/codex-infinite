export function installNativeProjectChecklist() {
  const VERSION = '2026-09-07.1', KEY = 'ccc.project-checklist.pending.v1';
  if (window.__cccProjectChecklist?.version === VERSION) return;
  window.__cccProjectChecklist?.dispose();
  let project = null, items = [], loaded = '', pending = [], error = '', storageError = '';
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) pending = saved; }
  catch { storageError = '无法读取待保存任务，请勿关闭窗口'; }
  const make = (tag, text) => { const node = document.createElement(tag); if (text) node.textContent = text; return node; };
  const style = make('style'); style.textContent = `
    [data-ccc-checklist]{position:fixed;inset:0;margin:auto;width:min(600px,calc(100vw - 48px));max-height:80vh;padding:24px;border:1px solid #8885;border-radius:16px;background:var(--color-background-primary,#252525);color:var(--color-text,#eee);box-shadow:0 20px 80px #0006;font:14px/1.5 system-ui}
    [data-ccc-checklist]::backdrop{background:#0006}
    [data-ccc-checklist] header{display:flex;align-items:center;justify-content:space-between;gap:16px}
    [data-ccc-checklist] h2{font-size:18px;margin:0}[data-ccc-checklist] p{color:#999;margin:6px 0 18px;overflow-wrap:anywhere}
    [data-ccc-checklist] button{cursor:pointer;border:1px solid #8885;border-radius:7px;padding:5px 10px;background:transparent;color:inherit}
    [data-ccc-checklist] form{display:flex;gap:8px;margin:16px 0}
    [data-ccc-checklist] input[type=text]{min-width:0;flex:1;border:1px solid #8885;border-radius:7px;background:transparent;color:inherit;padding:8px}
    [data-ccc-checklist] ul{list-style:none;padding:0;margin:12px 0;max-height:45vh;overflow:auto}
    [data-ccc-checklist] li{display:flex;align-items:center;gap:10px;padding:6px 0}
    [data-ccc-checklist] li[data-done=true] input[type=text]{text-decoration:line-through;opacity:.55}
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
  function view() {
    const result = items.map(item => ({ id: item.id, text: item.text, done: item.done }));
    for (const action of pending.filter(value => value.projectKey === project?.key)) {
      const index = result.findIndex(item => item.id === action.id);
      if (action.type === 'delete') { if (index >= 0) result.splice(index, 1); }
      else { const item = { id: action.id, text: action.text, done: action.done }; if (index >= 0) result[index] = item; else result.push(item); }
    }
    return result;
  }
  function state() {
    const busy = pending.some(action => action.projectKey === project?.key);
    status.textContent = storageError || error || (busy ? '正在保存…' : loaded === project?.key ? '已保存' : '正在读取…');
    input.disabled = add.disabled = loaded !== project?.key;
  }
  function act(type, item) {
    pending.push({ projectKey: project.key, type, id: item.id, text: item.text, done: item.done, requestId: crypto.randomUUID() });
    persist(); render();
  }
  function render() {
    state(); list.replaceChildren(); const values = view();
    count.textContent = `${values.filter(item => !item.done).length} 项待办 · ${values.filter(item => item.done).length} 项已完成`;
    if (!values.length) { list.append(make('li', loaded === project?.key ? '还没有任务，先记下一件想做的事。' : '正在读取清单…')); return; }
    for (const item of values) {
      const row = make('li'), check = make('input'), text = make('input'), remove = make('button', '删除');
      row.dataset.done = String(item.done); check.type = 'checkbox'; check.checked = item.done; check.setAttribute('aria-label', '完成：' + item.text);
      text.type = 'text'; text.value = item.text; text.maxLength = 5000; text.setAttribute('aria-label', '任务内容');
      check.disabled = text.disabled = remove.disabled = loaded !== project?.key;
      check.addEventListener('change', () => act('upsert', { ...item, done: check.checked }));
      text.addEventListener('change', () => { if (text.value.trim()) act('upsert', { ...item, text: text.value.trim() }); else text.value = item.text; });
      remove.addEventListener('click', () => act('delete', item)); row.append(check, text, remove); list.append(row);
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); if (input.value.trim() && loaded === project?.key) { act('upsert', { id: crypto.randomUUID(), text: input.value.trim(), done: false }); input.value = ''; input.focus(); } });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.__cccProjectChecklist = { version: VERSION,
    openGeneral() { this.open({ key: 'ccc:general-inbox:v1', general: true, name: '先记下想做的事，之后再确定归属。' }); },
    open(value) { title.textContent = value.general ? '综合任务清单' : '任务清单'; dialog.setAttribute('aria-label', value.general ? '综合任务清单' : '项目任务清单'); input.placeholder = value.general ? '有什么想做的？先记在这里…' : '想在这个项目里做什么？'; project = value; items = []; loaded = ''; error = ''; subtitle.textContent = value.name || value.id; input.value = ''; render(); if (!dialog.open) dialog.showModal(); },
    packet() { return { projectKey: project?.key || '', actions: pending.slice(0, 20) }; },
    accept(result) {
      const before = JSON.stringify(view());
      pending = pending.filter(action => !result.acknowledged.includes(action.requestId)); persist(); error = result.error || '';
      const first = loaded !== project?.key;
      if (result.projectKey === project?.key && Array.isArray(result.items)) { items = result.items; loaded = result.projectKey; }
      if (first || before !== JSON.stringify(view())) render(); else state();
    },
    dispose() { dialog.remove(); style.remove(); }
  };
}
export function buildNativeProjectChecklistScript() { return `(${installNativeProjectChecklist.toString()})();`; }
