import { actionIssue } from './model.js';

const TITLES = { create: '添加任务', edit: '编辑任务', assign: '指派到会话', return: '退回任务中心', complete: '完成任务', reopen: '重新打开任务', delete: '删除任务' };
const CONFIRM = { create: '保存待办', edit: '保存', assign: '确认指派', return: '确认退回', complete: '确认完成', reopen: '重新打开', delete: '确认删除' };

export function createEditorView({ root, node, controller }) {
  let identity = '', refs = null, choicesSignature = '';
  root.addEventListener('submit', event => { event.preventDefault(); void controller.submit(); });
  root.addEventListener('input', event => {
    const name = event.target.name;
    if (['text', 'target', 'ownerDeviceId'].includes(name)) controller.draft({ [name]: event.target.value });
  });
  root.addEventListener('change', event => {
    const name = event.target.name;
    if (['target', 'ownerDeviceId'].includes(name)) controller.draft({ [name]: event.target.value });
  });
  root.addEventListener('click', event => { if (event.target.closest('[data-task-center-cancel]')) controller.cancel(); });
  function render(state) {
    const editor = state.editor;
    if (root.hidden !== !editor) root.hidden = !editor;
    if (!editor) { identity = ''; refs = null; if (root.childNodes.length) root.replaceChildren(); return; }
    const nextIdentity = `${editor.type}:${editor.key}:${editor.id}`;
    if (nextIdentity !== identity) {
      identity = nextIdentity; choicesSignature = '';
      const heading = node('h3', '', TITLES[editor.type]);
      const title = node('div', 'task-center-editor-title');
      const close = node('button', 'quiet-button', '取消'); close.type = 'button'; close.dataset.taskCenterCancel = '';
      title.append(heading, close);
      const fields = node('div', 'task-center-editor-fields');
      refs = { text: null, target: null, owner: null, confirm: null, close, issue: null };
      if (['create', 'edit'].includes(editor.type)) {
        const label = node('label', 'field'); label.append(node('span', '', '任务内容'));
        refs.text = node('textarea'); refs.text.name = 'text'; refs.text.rows = 3; refs.text.maxLength = 5000; refs.text.required = true; refs.text.value = editor.text;
        label.append(refs.text); fields.append(label);
      } else {
        fields.append(node('p', 'task-center-editor-preview', editor.text));
      }
      if (editor.type === 'create') {
        const label = node('label', 'field'); label.append(node('span', '', '保存到设备'));
        refs.owner = node('select'); refs.owner.name = 'ownerDeviceId'; label.append(refs.owner); fields.append(label);
      }
      if (editor.type === 'assign') {
        const label = node('label', 'field'); label.append(node('span', '', '设备与会话'));
        refs.target = node('select'); refs.target.name = 'target'; refs.target.required = true; label.append(refs.target); fields.append(label);
      }
      const note = editor.type === 'assign' ? '指派后进入所选会话的暂停待办，点击“入队”才发送。'
        : editor.type === 'delete' ? '删除这项任务；已经交付的消息和执行记录仍保留在会话中。'
          : editor.type === 'return' ? '解除当前指派，回到任务中心的待领取列表。'
            : editor.type === 'create' ? '只保存任务内容，之后可以指派给任意在线设备的会话。' : '';
      const footer = node('div', 'task-center-editor-footer');
      refs.issue = node('p', 'task-center-review');
      refs.confirm = node('button', 'primary-button', CONFIRM[editor.type]); refs.confirm.type = 'submit';
      footer.append(node('p', 'muted', note), refs.confirm); root.replaceChildren(title, fields, refs.issue, footer);
      refs.text?.focus();
    }
    const choiceData = editor.type === 'assign'
      ? state.targets.map(task => [task.key, `${task.deviceName} · ${task.title || task.id}`])
      : (state.catalog?.devices || []).filter(entry => entry.status === 'connected').map(entry => [entry.device.id, entry.device.name || entry.device.id]);
    const signature = JSON.stringify(choiceData);
    if (signature !== choicesSignature) {
      choicesSignature = signature;
      const select = refs.target || refs.owner;
      if (select) {
        const options = choiceData.map(([value, label]) => { const option = node('option', '', label); option.value = value; return option; });
        if (refs.target) { const empty = node('option', '', options.length ? '选择设备与会话' : '暂无在线会话'); empty.value = ''; options.unshift(empty); }
        select.replaceChildren(...options); select.value = refs.target ? editor.target : editor.ownerDeviceId;
      }
    }
    const item = state.rows.find(row => row.key === editor.key);
    const issue = editor.type === 'create' ? '' : actionIssue(item, editor.type, state.stale);
    if (refs.issue.textContent !== issue) refs.issue.textContent = issue;
    if (refs.issue.hidden !== !issue) refs.issue.hidden = !issue;
    for (const input of root.querySelectorAll('input,textarea,select,button')) {
      const disabled = state.pending || (input !== refs.close && Boolean(item?.deliveryReservation));
      if (input.disabled !== disabled) input.disabled = disabled;
    }
    const blocked = state.pending || state.stale || Boolean(issue) || (editor.type === 'assign' && !state.targets.length);
    if (refs.confirm.disabled !== blocked) refs.confirm.disabled = blocked;
    const label = state.pending ? '保存中…' : CONFIRM[editor.type];
    if (refs.confirm.textContent !== label) refs.confirm.textContent = label;
  }
  return { render };
}
