const SOURCES = new Set(['codex', 'chatgpt']);
const KINDS = new Set(['projects', 'tasks', 'pinned', 'custom']);
export const SIDEBAR_ACTIONS = Object.freeze(['sidebar-show', 'section-create', 'section-rename', 'section-delete', 'section-shift', 'item-move', 'item-shift', 'open']);
export function sidebarError(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
const text = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';
function identifier(value, max = 260) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw sidebarError('侧边栏标识无效');
  return value;
}
function array(value, max) { if (!Array.isArray(value) || value.length > max) throw sidebarError('侧边栏数据超出范围'); return value; }
function keys(values, max = 8192) { const result = array(values, max).map(value => identifier(value)); if (new Set(result).size !== result.length) throw sidebarError('侧边栏包含重复条目'); return result; }
function unique(items) { if (new Set(items.map(item => item.key || item.id)).size !== items.length) throw sidebarError('侧边栏标识重复'); return items; }

export function normalizeSidebarSnapshot(value = {}) {
  if (value.schemaVersion !== 1) throw sidebarError('该设备尚不支持原生侧边栏协议', 503);
  const conversations = unique(array(value.conversations, 8192).map(item => {
    if (!SOURCES.has(item?.source)) throw sidebarError('未知会话来源');
    return { key: identifier(item.key), id: identifier(item.id, 200), source: item.source, title: text(item.title) || '未命名会话',
      hostId: text(item.hostId, 160) || 'local', route: typeof item.route === 'string' && /^\/(?:[A-Za-z0-9_/-]|%[0-9A-Fa-f]{2}){1,480}$/.test(item.route) ? item.route : null,
      cwd: text(item.cwd, 1024) || null, status: text(item.status, 32) || 'unknown' };
  }));
  const knownConversations = new Set(conversations.map(item => item.key));
  const projects = unique(array(value.projects, 1024).map(item => {
    if (!SOURCES.has(item?.source)) throw sidebarError('未知项目来源');
    const conversationKeys = keys(item.conversationKeys, 2048);
    if (conversationKeys.some(key => !knownConversations.has(key))) throw sidebarError('项目会话引用无效');
    return { key: identifier(item.key), id: identifier(item.id, 200), source: item.source, name: text(item.name) || '未命名项目',
      hostId: text(item.hostId, 160) || 'local', sourceDirectories: [...new Set(array(item.sourceDirectories, 64).map(value => text(value, 1024)).filter(Boolean))],
      conversationKeys, childrenLoaded: item.childrenLoaded === true };
  }));
  const known = new Set([...knownConversations, ...projects.map(item => item.key)]);
  const sections = unique(array(value.sections, 128).map(item => {
    if (!KINDS.has(item?.kind)) throw sidebarError('未知分区类型');
    const itemKeys = keys(item.itemKeys);
    if (itemKeys.some(key => !known.has(key))) throw sidebarError('分区条目引用无效');
    return { id: identifier(item.id, 200), name: text(item.name, 100) || '未命名分区', kind: item.kind, collapsed: item.collapsed === true, itemKeys,
      hiddenItemCount: Number.isSafeInteger(item.hiddenItemCount) && item.hiddenItemCount > 0 ? item.hiddenItemCount : 0 };
  }));
  return { schemaVersion: 1, revision: /^[0-9a-f]{64}$/.test(value.revision || '') ? value.revision : null,
    sections, projects, conversations, capabilities: Array.isArray(value.capabilities) ? SIDEBAR_ACTIONS.filter(action => value.capabilities.includes(action)) : [] };
}

export function sidebarLayout(snapshot) {
  return JSON.stringify({ sections: snapshot.sections.map(({ id, name, kind, itemKeys }) => ({ id, name, kind, itemKeys })),
    projects: snapshot.projects.map(({ key, conversationKeys }) => ({ key, conversationKeys })) });
}

export function normalizeSidebarAction(input = {}) {
  if (!SIDEBAR_ACTIONS.includes(input.action)) throw sidebarError('不支持此侧边栏操作');
  if (input.action === 'sidebar-show') return { action: 'sidebar-show' };
  if (!/^[0-9a-f]{64}$/.test(input.expectedRevision || '')) throw sidebarError('缺少侧边栏版本，请刷新后重试', 409);
  const result = { action: input.action, expectedRevision: input.expectedRevision };
  if (input.action !== 'section-create') result.sectionId = identifier(input.sectionId, 200);
  if (['section-create', 'section-rename'].includes(input.action)) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) throw sidebarError('分区名称需为 1 至 100 个字符');
    result.name = input.name.trim();
  }
  if (input.action.startsWith('item-') || input.action === 'open') result.itemKey = identifier(input.itemKey);
  if (input.action === 'item-move') result.targetSectionId = identifier(input.targetSectionId, 200);
  if (input.action.endsWith('-shift')) {
    if (![-1, 1].includes(input.direction)) throw sidebarError('排序方向无效');
    result.direction = input.direction;
  }
  return result;
}

export function validateSidebarAction(snapshot, input) {
  const action = normalizeSidebarAction(input);
  if (snapshot.revision !== action.expectedRevision) throw sidebarError('所属设备的侧边栏已变化，请刷新后重试', 409);
  const section = snapshot.sections.find(section => section.id === action.sectionId);
  if (action.action !== 'section-create' && !section) throw sidebarError('原生分区已不存在', 409);
  if (['section-rename', 'section-delete'].includes(action.action) && section.kind !== 'custom') throw sidebarError('系统分区不支持改名或删除');
  if (action.itemKey && !section.itemKeys.includes(action.itemKey)
    && !snapshot.projects.some(project => section.itemKeys.includes(project.key) && project.conversationKeys.includes(action.itemKey))) throw sidebarError('条目已不在原分区，请刷新后重试', 409);
  if (action.action === 'item-move') {
    const target = snapshot.sections.find(section => section.id === action.targetSectionId);
    if (!target) throw sidebarError('所属设备上不存在目标分区', 409);
    const project = snapshot.projects.some(project => project.key === action.itemKey);
    if ((target.kind === 'projects' && !project) || (target.kind === 'tasks' && project)) throw sidebarError('项目和会话的默认分区不同');
  }
  if (action.action === 'item-shift' && !section.itemKeys.includes(action.itemKey)) throw sidebarError('请使用项目内的原生排序');
  return action;
}
