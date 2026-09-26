import { requestJson } from '../../core/transport.js';

const LANES = ['todo', 'doing', 'paused', 'done', 'review'];
const ACTIONS = { todo: [['start', '开始']], doing: [['pause', '暂停'], ['todo', '回待办'], ['complete', '完成']], paused: [['start', '继续'], ['todo', '回待办']] };

export function createPersonalPanelBoard({ $, showToast, formatDate, state, requestOpen }) {
  const root = $('[data-testid="personal-panel-board"]');
  const message = $('[data-testid="personal-panel-status"]');
  let snapshot = null;
  let linkSchema = null;
  let activeLinkTask = null;
  let pendingLinkAction = null;
  let lastRead = 0, inFlight = null, signature = '';

  function render() {
    const nextSignature = JSON.stringify(snapshot);
    if (nextSignature === signature) return;
    signature = nextSignature;
    for (const lane of LANES) {
      const list = $(`[data-personal-panel-list="${lane}"]`);
      const tasks = (snapshot?.tasks || []).filter(task => (task.lane === 'cancelled' ? 'review' : task.lane) === lane);
      $(`[data-personal-panel-count="${lane}"]`).textContent = String(tasks.length);
      list.replaceChildren(...tasks.map(task => {
        const card = document.createElement('article'); card.className = 'dispatch-card';
        const title = document.createElement('h4'); title.textContent = task.name;
        const meta = document.createElement('div'); meta.className = 'dispatch-meta';
        meta.textContent = [task.status, task.category, task.planDate ? formatDate(task.planDate) : ''].filter(Boolean).join(' · ');
        card.append(title, meta);
        if (activeLinkTask?.id === task.id && activeLinkTask.needsInitialize) {
          const setup = document.createElement('div'); setup.className = 'dispatch-actions';
          const explanation = document.createElement('span'); explanation.textContent = '需先在当前 Anytype 任务类型中建立专用关联属性；不会发送消息或完成任务。';
          const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'task-open'; confirm.textContent = '初始化关联属性'; confirm.dataset.personalPanelInitialize = task.id;
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'task-open'; cancel.textContent = '取消'; cancel.dataset.personalPanelCancel = task.id;
          setup.append(explanation, confirm, cancel); card.append(setup);
        }
        if (activeLinkTask?.id === task.id && !activeLinkTask.needsInitialize) {
          const panel = document.createElement('div'); panel.className = 'dispatch-actions';
          const select = document.createElement('select'); select.dataset.personalPanelTarget = task.id;
          select.setAttribute('aria-label', `选择${task.name}要关联的 Codex 会话`);
          select.append(new Option('选择现有 Codex 会话', ''));
          for (const thread of state.tasks.filter(item => item.provider !== 'terminal' && item.device?.kind !== 'remote-codex' && item.device?.id)) select.append(new Option(thread.title, thread.id));
          const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'task-open'; confirm.textContent = '确认关联'; confirm.dataset.personalPanelLink = task.id;
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'task-open'; cancel.textContent = '取消'; cancel.dataset.personalPanelCancel = task.id;
          panel.append(select, confirm, cancel); card.append(panel);
        }
        if (activeLinkTask?.id === task.id && activeLinkTask.links?.length) {
          const links = document.createElement('div'); links.className = 'dispatch-meta';
          for (const link of activeLinkTask.links) {
            const thread = state.tasks.find(item => item.id === link.sessionId && item.device?.id === link.deviceId);
            const row = document.createElement('div'); row.textContent = thread ? `已关联：${thread.title}` : `已关联会话 ${link.sessionId}（本机列表暂不可见）`;
            if (thread) {
              const open = document.createElement('button'); open.type = 'button'; open.className = 'task-open'; open.textContent = '打开会话'; open.dataset.personalPanelOpen = link.sessionId;
              row.append(open);
            }
            const unlink = document.createElement('button'); unlink.type = 'button'; unlink.className = 'task-open'; unlink.textContent = '解除关联'; unlink.dataset.personalPanelUnlink = task.id; unlink.dataset.sessionId = link.sessionId; unlink.dataset.deviceId = link.deviceId;
            row.append(unlink); links.append(row);
          }
          card.append(links);
        }
        if (pendingLinkAction?.taskId === task.id) {
          const confirmation = document.createElement('div'); confirmation.className = 'dispatch-actions';
          const explanation = document.createElement('span'); explanation.textContent = `${pendingLinkAction.action === 'link' ? '建立' : '解除'}与「${pendingLinkAction.label}」的会话关联？不会发送消息，也不会改变任务状态。`;
          const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'task-open'; confirm.textContent = pendingLinkAction.action === 'link' ? '确认关联' : '确认解除'; confirm.dataset.personalPanelConfirm = task.id;
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'task-open'; cancel.textContent = '取消'; cancel.dataset.personalPanelCancel = task.id;
          confirmation.append(explanation, confirm, cancel); card.append(confirmation);
        }
        if (!task.readOnly && task.revision) {
          const actions = document.createElement('div'); actions.className = 'dispatch-actions';
          const available = [...(ACTIONS[task.lane] || [])];
          if (task.lane === 'todo') available.push(['complete', '完成']);
          const linkButton = document.createElement('button'); linkButton.type = 'button'; linkButton.className = 'task-open'; linkButton.textContent = '关联会话'; linkButton.dataset.personalPanelManageLinks = task.id; actions.append(linkButton);
          for (const [action, label] of available) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'task-open';
            button.textContent = label; button.dataset.personalPanelAction = action; button.dataset.personalPanelId = task.id;
            actions.append(button);
          }
          card.append(actions);
        }
        return card;
      }));
      if (!tasks.length) { const empty = document.createElement('div'); empty.className = 'column-empty'; empty.textContent = '暂无任务'; list.append(empty); }
    }
  }

  async function load({ force = false } = {}) {
    if (inFlight) return inFlight;
    if (!force && Date.now() - lastRead < 20000) return;
    lastRead = Date.now();
    inFlight = (async () => {
      try {
        const data = await requestJson('/api/personal-panel/tasks', { cache: 'no-store' });
        if (data.status !== 'ok') throw new Error(data.message || 'Personal Panel 暂时无法读取');
        snapshot = { owner: data.owner, tasks: data.tasks };
        message.textContent = `已连接 Anytype 原生任务 · ${data.tasks.length} 项${data.nextCursor ? '（仅前 100 项；更多请在 Personal Panel 查看）' : ''}`;
      } catch (error) { message.textContent = error.message; }
      render();
    })();
    try { await inFlight; } finally { inFlight = null; }
  }

  async function loadLinksForTask(task) {
    try {
      const query = new URLSearchParams({ id: task.id, accountId: snapshot.owner.accountId, spaceId: snapshot.owner.spaceId });
      const data = await requestJson(`/api/personal-panel/links?${query}`, { cache: 'no-store' });
      if (data.status !== 'ok' || !data.task) throw new Error(data.message || '原生关联暂不可读');
      activeLinkTask = { id: task.id, ...data.task }; pendingLinkAction = null; signature = ''; render();
    } catch (error) { activeLinkTask = null; pendingLinkAction = null; signature = ''; render(); showToast(`${error.message}；请刷新后核对。`); }
  }

  async function handleClick(event) {
    const open = event.target.closest('[data-personal-panel-open]');
    if (open && root.contains(open)) {
      const thread = state.tasks.find(item => item.id === open.dataset.personalPanelOpen);
      if (thread) requestOpen(thread); else showToast('会话暂不可见，请先刷新会话列表。');
      return;
    }
    const manage = event.target.closest('[data-personal-panel-manage-links]');
    if (manage && root.contains(manage)) {
      const task = snapshot?.tasks.find(item => item.id === manage.dataset.personalPanelManageLinks);
      if (!task) return;
      if (!linkSchema) {
        try {
          const data = await requestJson('/api/personal-panel/links', { cache: 'no-store' });
          if (data.status !== 'ok') throw new Error(data.message || '原生关联能力暂不可读');
          linkSchema = data.schema;
        } catch (error) { showToast(error.message); return; }
      }
      if (!linkSchema?.ready) { activeLinkTask = { id: task.id, needsInitialize: true }; pendingLinkAction = null; signature = ''; render(); return; }
      await loadLinksForTask(task);
      return;
    }
    const initialize = event.target.closest('[data-personal-panel-initialize]');
    if (initialize && root.contains(initialize)) {
      const task = snapshot?.tasks.find(item => item.id === initialize.dataset.personalPanelInitialize);
      if (!task || !activeLinkTask?.needsInitialize) return;
      initialize.disabled = true;
      try {
        const data = await requestJson('/api/personal-panel/links', { method: 'POST', body: { action: 'initialize', owner: snapshot.owner, confirmed: true } });
        linkSchema = data.schema;
        await loadLinksForTask(task);
      } catch (error) { showToast(`${error.message}；请在 Personal Panel 核对属性，勿直接重试。`); initialize.disabled = false; }
      return;
    }
    const cancel = event.target.closest('[data-personal-panel-cancel]');
    if (cancel && root.contains(cancel)) { if (pendingLinkAction) pendingLinkAction = null; else activeLinkTask = null; signature = ''; render(); return; }
    const link = event.target.closest('[data-personal-panel-link], [data-personal-panel-unlink]');
    if (link && root.contains(link)) {
      const action = link.hasAttribute('data-personal-panel-unlink') ? 'unlink' : 'link';
      const task = snapshot?.tasks.find(item => item.id === activeLinkTask?.id);
      const select = root.querySelector('[data-personal-panel-target]');
      const thread = action === 'link' ? state.tasks.find(item => item.id === select?.value) : state.tasks.find(item => item.id === link.dataset.sessionId && item.device?.id === link.dataset.deviceId);
      const deviceId = action === 'link' ? thread?.device?.id : link.dataset.deviceId;
      const sessionId = action === 'link' ? thread?.id : link.dataset.sessionId;
      if (!task || !deviceId || !sessionId) return showToast('请先选择本机 Codex 会话。');
      pendingLinkAction = { taskId: task.id, action, deviceId, sessionId, label: thread?.title || sessionId }; signature = ''; render();
      return;
    }
    const confirm = event.target.closest('[data-personal-panel-confirm]');
    if (confirm && root.contains(confirm)) {
      const pending = pendingLinkAction, task = snapshot?.tasks.find(item => item.id === pending?.taskId);
      if (!task || !activeLinkTask?.revision || pending.taskId !== confirm.dataset.personalPanelConfirm) return;
      confirm.disabled = true;
      try {
        const data = await requestJson('/api/personal-panel/links', { method: 'POST', body: { action: pending.action, owner: snapshot.owner, id: task.id, revision: activeLinkTask.revision, confirmed: true, deviceId: pending.deviceId, sessionId: pending.sessionId } });
        activeLinkTask = { id: task.id, ...data.task }; pendingLinkAction = null; signature = ''; render();
        showToast(`已从 Anytype 读回${pending.action === 'link' ? '关联' : '解除'}结果。`);
      } catch (error) { showToast(`${error.message}；请刷新核对，勿直接重试。`); confirm.disabled = false; }
      return;
    }
    const button = event.target.closest('[data-personal-panel-action]');
    if (!button || !root.contains(button)) return;
    const task = snapshot?.tasks.find(item => item.id === button.dataset.personalPanelId);
    if (!task || !task.revision || task.readOnly) return showToast('任务状态已变化，请刷新后核对。');
    button.disabled = true;
    try {
      const data = await requestJson('/api/personal-panel/tasks', { method: 'PATCH', body: { owner: snapshot.owner, id: task.id, revision: task.revision, action: button.dataset.personalPanelAction } });
      snapshot = { owner: data.owner, tasks: data.tasks };
      message.textContent = '已从 Anytype 读回最新任务状态';
      render();
    } catch (error) { showToast(`${error.message}；请先刷新核对，勿直接重试。`); button.disabled = false; }
  }

  root.addEventListener('click', handleClick);
  $('[data-action="refresh-personal-panel"]').addEventListener('click', () => void load({ force: true }));
  return { load };
}
