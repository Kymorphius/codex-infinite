import { BOARD_COLUMNS, conversationCatalog, conversationIdentity, filterConversations, openAction, validateSidebarPayload } from './model.js';

const $ = selector => document.querySelector(selector);
const formatTime = value => {
  const time = Date.parse(value); if (!time) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time);
};
const state = { sidebar: null, tasks: null, activities: new Map(), filters: { query: '', device: '', source: '', workType: '' }, loading: false, stale: false, error: '', busy: null };
let readVersion = 0;

async function body(response) {
  let value; try { value = await response.json(); } catch { throw Error('服务未返回有效数据'); }
  if (!response.ok) throw Object.assign(Error(value.message || '服务暂不可用'), { status: response.status });
  return value;
}
async function request(path, options = {}) { return body(await fetch(path, { cache: 'no-store', ...options })); }

function catalog() { return conversationCatalog(state.sidebar, state.tasks, state.activities, { stale: state.stale }); }
function visible() { return filterConversations(catalog(), state.filters); }

function renderFilters(items) {
  const owners = [...new Map(items.map(item => [item.deviceId, item.deviceName])).entries()];
  const devices = $('#device'), currentDevice = devices.value;
  devices.replaceChildren(new Option('全部设备', ''), ...owners.map(([id, name]) => new Option(name, id)));
  devices.value = owners.some(([id]) => id === currentDevice) ? currentDevice : '';
  const types = [...new Set(items.map(item => item.workType))].sort();
  const type = $('#work-type'), currentType = type.value;
  type.replaceChildren(new Option('全部类型', ''), ...types.map(name => new Option(name, name)));
  type.value = types.includes(currentType) ? currentType : '';
}

function renderDevices() {
  const host = $('#device-status'); host.replaceChildren();
  for (const owner of state.sidebar?.devices || []) if (owner.status !== 'connected') {
    const item = document.createElement('span'); item.className = `device-pill ${owner.status}`;
    item.textContent = `${owner.device.name || owner.device.id} · ${owner.status === 'loading' ? '连接中' : '离线'}`; host.append(item);
  }
}

function card(item) {
  const node = $('#conversation-card-template').content.firstElementChild.cloneNode(true);
  node.dataset.conversationId = item.identity;
  node.querySelector('.source-badge').textContent = item.source === 'chatgpt' ? 'ChatGPT' : 'Codex';
  node.querySelector('.type-badge').textContent = item.workType;
  node.querySelector('h3').textContent = item.title || '未命名会话';
  const project = node.querySelector('.project-name'); project.textContent = item.project?.name || item.cwd || '未归入项目';
  node.querySelector('.device-name').textContent = item.deviceName;
  node.querySelector('.updated-at').textContent = formatTime(item.updatedAt);
  node.querySelector('.state-reason').textContent = item.state.reason;
  const button = node.querySelector('button');
  try { openAction(item); } catch (error) { button.disabled = true; button.title = error.message; button.textContent = '暂不可打开'; }
  if (state.busy === item.identity) { button.disabled = true; button.textContent = '正在打开…'; }
  return node;
}

function render() {
  const items = catalog(), rows = visible(); renderFilters(items); renderDevices();
  $('#catalog-count').textContent = items.length; $('#result-count').textContent = state.loading && !state.sidebar ? '正在读取会话…' : `显示 ${rows.length} 个，共 ${items.length} 个会话`;
  $('#sync-status').textContent = state.loading ? '正在同步' : state.stale ? '显示上次结果' : `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  $('#read-error').hidden = !state.error; $('#read-error').textContent = state.error;
  const board = $('#conversation-board'); board.setAttribute('aria-busy', String(state.loading)); board.replaceChildren();
  for (const definition of BOARD_COLUMNS) {
    const column = $('#column-template').content.firstElementChild.cloneNode(true), subset = rows.filter(item => item.state.id === definition.id);
    column.dataset.state = definition.id; column.querySelector('.column-marker').style.background = definition.color;
    column.querySelector('h2').textContent = definition.name; column.querySelector('.column-count').textContent = subset.length;
    column.querySelector('.column-description').textContent = definition.description;
    const list = column.querySelector('.card-list'); subset.forEach(item => list.append(card(item)));
    column.querySelector('.column-empty').hidden = subset.length > 0; board.append(column);
  }
  $('#empty-state').hidden = rows.length > 0 || state.loading;
}

async function readActivities(items, version) {
  const active = items.filter(item => item.source === 'codex' && (item.task?.status === 'active' || item.status === 'active')).slice(0, 24);
  await Promise.allSettled(active.map(async item => {
    const path = item.deviceKind === 'local-codex' ? `/api/node/activity/${encodeURIComponent(item.id)}` : `/api/tasks/${encodeURIComponent(item.id)}/activity?device=${encodeURIComponent(item.deviceId)}`;
    const value = await request(path), activity = value.activity || value;
    if (version === readVersion) state.activities.set(conversationIdentity(item.deviceId, item.key), activity);
  }));
}

async function refresh() {
  const version = ++readVersion; state.loading = true; render();
  try {
    const [sidebar, tasks] = await Promise.all([request('/api/sidebar'), request('/api/tasks')]);
    if (version !== readVersion) return;
    state.sidebar = validateSidebarPayload(sidebar); state.tasks = tasks; state.activities = new Map(); state.stale = false; state.error = ''; render();
    await readActivities(catalog(), version); if (version === readVersion) render();
  } catch (error) { if (version === readVersion) { state.error = error.message || '会话看板读取失败'; state.stale = Boolean(state.sidebar); } }
  finally { if (version === readVersion) { state.loading = false; render(); } }
}

async function openConversation(identity) {
  if (state.busy) return;
  const item = catalog().find(row => row.identity === identity); if (!item) return;
  let input; try { input = openAction(item); } catch (error) { showNotice(error.message, true); return; }
  state.busy = identity; render(); showNotice('正在等待所属设备打开会话…');
  try {
    const result = await request('/api/sidebar/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    if (!result.applied || result.deviceId !== item.deviceId) throw Error('所属设备未确认打开操作');
    showNotice(item.deviceKind === 'local-codex' ? `已打开「${item.title}」` : `已在 ${item.deviceName} 打开「${item.title}」`);
    if (item.deviceKind === 'local-codex' && window.parent !== window) window.parent.postMessage({ type: 'codex-control-console-close' }, 'app://-');
  } catch (error) { showNotice(`${error.message || '打开失败'}，请刷新后核对`, true); }
  finally { state.busy = null; render(); }
}

function showNotice(message, error = false) { const node = $('#action-notice'); node.hidden = false; node.className = `notice${error ? ' error' : ''}`; node.textContent = message; }

for (const [selector, key] of [['#search', 'query'], ['#device', 'device'], ['#source', 'source'], ['#work-type', 'workType']]) {
  $(selector).addEventListener(selector === '#search' ? 'input' : 'change', event => { state.filters[key] = event.target.value; render(); });
}
$('#clear').addEventListener('click', () => { state.filters = { query: '', device: '', source: '', workType: '' }; $('#search').value = ''; render(); $('#search').focus(); });
$('#refresh').addEventListener('click', () => void refresh());
$('#conversation-board').addEventListener('click', event => { const button = event.target.closest('.open-conversation'); if (button && !button.disabled) void openConversation(button.closest('[data-conversation-id]').dataset.conversationId); });
if (window.parent !== window) { $('#back').addEventListener('click', event => { event.preventDefault(); window.parent.postMessage({ type: 'codex-control-console-close' }, 'app://-'); }); window.parent.postMessage({ type: 'codex-control-console-ready' }, 'app://-'); }
void refresh();
const timer = window.setInterval(() => { if (document.visibilityState === 'visible' && !state.loading && !state.busy) void refresh(); }, 10000);
window.addEventListener('pagehide', () => { window.clearInterval(timer); ++readVersion; }, { once: true });
