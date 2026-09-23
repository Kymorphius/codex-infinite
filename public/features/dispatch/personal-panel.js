import { requestJson } from '../../core/transport.js';

const LANES = ['todo', 'doing', 'paused', 'done', 'review'];
const ACTIONS = { todo: [['start', '开始']], doing: [['pause', '暂停'], ['todo', '回待办'], ['complete', '完成']], paused: [['start', '继续'], ['todo', '回待办']] };

export function createPersonalPanelBoard({ $, showToast, formatDate }) {
  const root = $('[data-testid="personal-panel-board"]');
  const message = $('[data-testid="personal-panel-status"]');
  let snapshot = null;
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
        if (!task.readOnly && task.revision) {
          const actions = document.createElement('div'); actions.className = 'dispatch-actions';
          const available = [...(ACTIONS[task.lane] || [])];
          if (task.lane === 'todo') available.push(['complete', '完成']);
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

  async function handleClick(event) {
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
