import { actionIssue, DELIVERY_REVIEW_MESSAGE, DEVICE_LABELS, statusLabel, taskDestination } from './model.js';
import { createEditorView } from './editor.js';

export function createTaskCenterView({ root, documentRef = document, controller, requestOpen, tasks = () => [], formatDate }) {
  const $ = selector => root.querySelector(selector);
  const node = (tag, className = '', text = '') => { const element = documentRef.createElement(tag); element.className = className; element.textContent = text; return element; };
  const list = $('[data-task-center-list]'), rows = new Map();
  const editor = createEditorView({ root: $('[data-task-center-editor]'), node, controller });
  let listSignature = '', deviceSignature = '';
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const setProperty = (element, name, value) => { if (element[name] !== value) element[name] = value; };
  function button(label, action, item, disabled = false) {
    const element = node('button', 'quiet-button small-button', label); element.type = 'button'; element.dataset.taskCenterAction = action;
    element.dataset.taskCenterKey = item.key; element.disabled = disabled; return element;
  }
  function card(item, state) {
    const element = node('article', 'task-center-row'); element.dataset.taskCenterKey = item.key;
    const main = node('div', 'task-center-content');
    const meta = node('div', 'task-center-meta');
    meta.append(node('span', 'task-center-device', item.deviceName), node('time', '', formatDate(item.createdAt)), node('span', 'task-center-status', statusLabel(item)));
    if (!item.connected) meta.append(node('span', 'task-center-offline', `${DEVICE_LABELS[item.deviceStatus]} · 上次记录`));
    if (item.scopeName) meta.append(node('span', '', item.scopeName));
    if (item.attachmentCount) meta.append(node('span', '', `${item.attachmentCount} 个附件`));
    const text = node('p', 'task-center-text', item.text);
    main.append(meta, text);
    const { deviceId, threadId } = taskDestination(item);
    if (threadId) {
      const target = tasks().find(task => task.id === threadId && task.device?.id === deviceId);
      const targetName = state.catalog.devices.find(entry => entry.device.id === deviceId)?.device.name || deviceId;
      main.append(node('p', 'task-center-assignment', `${targetName} · ${target?.title || item.assignedThreadTitle || threadId.slice(0, 8)}`));
    }
    if (item.deliveryReservation) main.append(node('p', 'task-center-review', DELIVERY_REVIEW_MESSAGE));
    const actions = node('div', 'task-center-actions');
    const disabled = state.pending || state.stale || !item.connected;
    if (item.source === 'checklist') {
      for (const [label, type] of [['编辑', 'edit'], [item.assignedThreadId ? '重派' : '指派', 'assign'],
        ...(item.assignedThreadId ? [['退回', 'return']] : []), [item.done ? '重开' : '完成', item.done ? 'reopen' : 'complete'], ['删除', 'delete']]) {
        const control = button(label, type, item, disabled || Boolean(actionIssue(item, type)));
        if (actionIssue(item, type)) control.title = actionIssue(item, type);
        actions.append(control);
      }
    } else actions.append(node('span', 'muted', '来源设备排期'));
    if (threadId) actions.append(button('打开会话', 'open', item, !item.connected));
    element.append(main, actions); return element;
  }
  function render(state) {
    const connected = (state.catalog?.devices || []).filter(entry => entry.status === 'connected').length;
    const all = state.catalog?.devices.length || 0;
    setText($('[data-task-center-summary]'), state.catalog ? `${state.rows.length} 项任务 · ${connected}/${all} 台设备在线` : '正在读取设备任务…');
    const message = state.error || state.notice;
    const feedback = $('[data-task-center-feedback]'); setText(feedback, message); setProperty(feedback, 'hidden', !message); feedback.classList.toggle('is-error', Boolean(state.error));
    const refresh = $('[data-task-center-refresh]'); setProperty(refresh, 'disabled', state.loading || state.pending); setText(refresh, state.loading ? '刷新中…' : '刷新');
    setProperty($('[data-task-center-add]'), 'disabled', state.pending || state.stale || !connected);
    const entries = state.catalog?.devices || [];
    const devicesHash = JSON.stringify(entries.map(entry => [entry.device.id, entry.device.name, entry.status, entry.message]));
    if (devicesHash !== deviceSignature) {
      deviceSignature = devicesHash;
      const select = $('[data-task-center-filter="device"]');
      const option = (name, value) => { const el = node('option', '', name); el.value = value; return el; };
      select.replaceChildren(option('全部设备', ''), ...entries.map(entry => option(`${entry.device.name || entry.device.id} · ${DEVICE_LABELS[entry.status]}`, entry.device.id)));
      select.value = state.filter.device;
      const health = $('[data-task-center-devices]');
      health.replaceChildren(...entries.filter(entry => entry.status !== 'connected').map(entry => {
        const label = node('span', 'task-center-device-notice', `${entry.device.name || entry.device.id} · ${DEVICE_LABELS[entry.status]}`);
        label.title = entry.message || '保留上次可用记录；恢复连接后可修改。'; return label;
      })); health.hidden = !health.childNodes.length;
    }
    const rowSignatures = state.visible.map(item => [item.key, JSON.stringify([item, state.stale, state.pending,
      tasks().find(task => task.id === taskDestination(item).threadId && task.device?.id === taskDestination(item).deviceId)?.title])]);
    const signature = JSON.stringify(rowSignatures);
    if (signature !== listSignature) {
      listSignature = signature;
      const keep = new Set(rowSignatures.map(([key]) => key));
      for (const [key, cached] of rows) if (!keep.has(key)) { cached.element.remove(); rows.delete(key); }
      let cursor = list.firstChild;
      for (let index = 0; index < state.visible.length; index++) {
        const item = state.visible[index], rowSignature = rowSignatures[index][1]; let cached = rows.get(item.key);
        if (cached?.signature !== rowSignature) {
          const element = card(item, state);
          if (cached) { if (cursor === cached.element) cursor = element; cached.element.replaceWith(element); }
          cached = { element, signature: rowSignature }; rows.set(item.key, cached);
        }
        if (cached.element !== cursor) list.insertBefore(cached.element, cursor);
        cursor = cached.element.nextSibling;
      }
    }
    const empty = $('[data-task-center-empty]'); setProperty(empty, 'hidden', Boolean(state.visible.length) || !state.catalog);
    setText(empty, state.rows.length ? '没有符合筛选条件的任务。' : '还没有任务，先记下一个待办。');
    const more = $('[data-task-center-more]'); setProperty(more, 'hidden', state.visible.length >= state.matches.length);
    setText($('[data-task-center-count]'), `${state.visible.length} / ${state.matches.length} 项`);
    editor.render(state);
  }
  function bind() {
    root.addEventListener('input', event => {
      const name = event.target.dataset.taskCenterFilter;
      if (name === 'query') controller.filter({ query: event.target.value.slice(0, 200) });
    });
    root.addEventListener('change', event => {
      const name = event.target.dataset.taskCenterFilter;
      if (name && name !== 'query') controller.filter({ [name]: event.target.value });
    });
    root.addEventListener('click', event => {
      if (event.target.closest('[data-task-center-refresh]')) return void controller.load({ explicit: true });
      if (event.target.closest('[data-task-center-add]')) return controller.edit('create');
      if (event.target.closest('[data-task-center-more]')) return controller.more();
      const control = event.target.closest('[data-task-center-action]'); if (!control || control.disabled) return;
      const type = control.dataset.taskCenterAction, key = control.dataset.taskCenterKey;
      if (type !== 'open') return controller.edit(type, key);
      const item = controller.getState().rows.find(row => row.key === key); if (!item?.connected) return;
      const destination = taskDestination(item);
      const target = tasks().find(task => task.id === destination.threadId && task.device?.id === destination.deviceId);
      if (target) requestOpen(target);
      else { setText($('[data-task-center-feedback]'), '目标会话暂不可用，请刷新会话目录后重试。'); $('[data-task-center-feedback]').hidden = false; }
    });
  }
  return { render, bind };
}
