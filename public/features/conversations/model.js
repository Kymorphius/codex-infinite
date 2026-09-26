const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export const BOARD_COLUMNS = Object.freeze([
  { id: 'active', name: '正在进行', description: '仍在执行或需要继续推进', color: '#2f80ed' },
  { id: 'confirm', name: '待确认', description: '正在等待你的授权或选择', color: '#f2a93b' },
  { id: 'accept', name: '待验收', description: '本轮已结束，等你检查结果', color: '#9b6ce8' },
  { id: 'done', name: '已完成', description: '已被明确归入完成分区', color: '#31a66a' },
  { id: 'error', name: '异常', description: '执行中断或发生错误', color: '#d9534f' },
  { id: 'review', name: '待核对', description: '原生状态不足，需要人工判断', color: '#8a8a91' }
]);

const STATE_SECTIONS = [
  ['confirm', /^(待确认|等待确认|approval|needs approval)$/i],
  ['accept', /^(待验收|等待验收|等待查看|review|needs review)$/i],
  ['done', /^(已完成|完成|done|completed)$/i],
  ['error', /^(异常|失败|error|failed)$/i],
  ['active', /^(正在进行|进行中|现在|active|in progress)$/i]
];
const TYPE_RULES = [
  ['绘画', /(绘画|画图|图片|图像|海报|插画|image|illustrat|render|cowart|runway|higgsfield)/i],
  ['写作', /(写作|文案|文章|小说|脚本|润色|翻译|write|writing|novel|copywriting)/i],
  ['开发', /(开发|代码|修复|调试|构建|部署|架构|编程|接口|测试|code|debug|build|deploy|api|qt|android|ios)/i],
  ['研究', /(研究|调研|资料|分析|对比|整理|文献|research|report|paper|study)/i]
];

export const conversationIdentity = (deviceId, key) => JSON.stringify([deviceId, key]);

export function validateSidebarPayload(payload) {
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.devices) || payload.devices.some(owner => !owner?.device?.id
    || !['connected', 'loading', 'offline'].includes(owner.status)
    || (owner.status === 'connected' && !owner.snapshot)
    || (owner.snapshot && (owner.snapshot.schemaVersion !== 1 || !Array.isArray(owner.snapshot.conversations)
      || !Array.isArray(owner.snapshot.projects) || !Array.isArray(owner.snapshot.sections))))) throw Error('会话目录格式无效，请刷新重试');
  return payload;
}

function directSections(snapshot, key) {
  return snapshot.sections.filter(section => section.itemKeys.includes(key));
}

function projectContext(snapshot, key) {
  const project = snapshot.projects.find(item => item.conversationKeys.includes(key));
  if (!project) return { project: null, sections: [] };
  return { project, sections: snapshot.sections.filter(section => section.itemKeys.includes(project.key)) };
}

function explicitState(sections) {
  for (const section of sections) for (const [state, pattern] of STATE_SECTIONS) if (pattern.test(section.name.trim())) return state;
  return null;
}

export function inferWorkType(conversation, project = null) {
  const text = [conversation.title, conversation.cwd, project?.name, ...(project?.sourceDirectories || [])].filter(Boolean).join(' ');
  return TYPE_RULES.find(([, pattern]) => pattern.test(text))?.[0] || '未分类';
}

export function inferBoardState(conversation, { directMemberships = [], task = null, activity = null } = {}) {
  const override = explicitState(directMemberships);
  if (override) return { id: override, reason: `原生分区：${directMemberships.find(section => STATE_SECTIONS.some(([, pattern]) => pattern.test(section.name.trim())))?.name}` };
  if ((activity?.approvals?.length || 0) > 0) return { id: 'confirm', reason: `${activity.approvals.length} 项操作等待确认` };
  const status = activity?.turnState || task?.status || conversation.status || 'unknown';
  if (['error', 'systemError', 'interrupted', 'failed'].includes(status)) return { id: 'error', reason: status === 'interrupted' ? '最近一次执行已中断' : '原生会话报告异常' };
  if (status === 'active') return { id: 'active', reason: '原生会话仍在执行' };
  if (status === 'completed' || status === 'idle') return { id: 'accept', reason: '本轮已结束，等待验收' };
  return { id: 'review', reason: '原生来源未提供可靠状态' };
}

export function conversationCatalog(sidebarPayload, tasksPayload = {}, activities = new Map(), { stale = false } = {}) {
  const tasks = new Map((tasksPayload?.tasks || []).filter(task => task.provider !== 'terminal').map(task => [`${task.device?.id || 'local'}\u0000${task.id}`, task]));
  const conversations = [];
  for (const owner of sidebarPayload?.devices || []) {
    const snapshot = owner.snapshot;
    if (!snapshot) continue;
    for (const conversation of snapshot.conversations) {
      const context = projectContext(snapshot, conversation.key);
      const memberships = directSections(snapshot, conversation.key);
      const task = tasks.get(`${owner.device.id}\u0000${conversation.id}`) || null;
      const state = inferBoardState(conversation, { directMemberships: memberships, task, activity: activities.get(conversationIdentity(owner.device.id, conversation.key)) });
      const section = memberships[0] || context.sections[0] || snapshot.sections[0] || null;
      conversations.push({ ...conversation, identity: conversationIdentity(owner.device.id, conversation.key), deviceId: owner.device.id,
        deviceName: owner.device.name || owner.device.id, deviceKind: owner.device.kind, ownerStatus: owner.status,
        stale: stale || owner.status !== 'connected', revision: snapshot.revision, capabilities: snapshot.capabilities || [],
        memberships, projectSections: context.sections, section, project: context.project, task, state,
        workType: inferWorkType(conversation, context.project), updatedAt: task?.updatedAt || null });
    }
  }
  for (const record of tasksPayload?.terminalConversations || []) {
    if (record.archived) continue;
    const owner = sidebarPayload?.devices?.find(value => value.device.id === record.deviceId);
    const project = owner?.snapshot?.projects.find(value => value.key === record.projectRef?.key) || null;
    const key = `terminal:${record.id}`;
    conversations.push({ ...record, source: 'terminal', key, identity: conversationIdentity(record.deviceId, key),
      deviceName: owner?.device.name || '本机', deviceKind: 'local-codex', ownerStatus: 'connected', stale,
      capabilities: ['open'], memberships: [], projectSections: [], section: null, project,
      state: { id: 'review', reason: record.status === 'running' ? '终端已连接，执行进度在会话中查看' : '进程已停止，可打开会话继续' },
      workType: inferWorkType(record, project), terminalConversation: record });
  }
  return conversations.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || collator.compare(a.title, b.title));
}

export function filterConversations(conversations, filters = {}) {
  const query = (filters.query || '').trim().toLocaleLowerCase();
  return conversations.filter(item => (!query || [item.title, item.cwd, item.project?.name, ...(item.project?.sourceDirectories || [])].some(value => String(value || '').toLocaleLowerCase().includes(query)))
    && (!filters.device || item.deviceId === filters.device) && (!filters.source || item.source === filters.source)
    && (!filters.workType || item.workType === filters.workType));
}

export function openAction(item) {
  if (item.stale || item.ownerStatus !== 'connected') throw Error('当前为缓存记录，请等待所属设备连接并刷新');
  if (!item.capabilities.includes('open')) throw Error('所属设备暂不支持从看板打开会话');
  if (item.provider === 'terminal') return { provider: 'terminal', conversationId: item.id };
  if (!/^[0-9a-f]{64}$/.test(item.revision || '')) throw Error('所属设备未提供有效版本，请刷新后重试');
  if (!item.section) throw Error('会话尚未映射到原生分区');
  return { action: 'open', deviceId: item.deviceId, itemKey: item.key, sectionId: item.section.id, expectedRevision: item.revision };
}

export function resolveOpenTarget(identity, sidebarPayload, tasksPayload = {}, activities = new Map()) {
  const item = conversationCatalog(validateSidebarPayload(sidebarPayload), tasksPayload, activities).find(row => row.identity === identity);
  if (!item) throw Error('会话已不在所属设备的最新侧栏中');
  return { item, input: openAction(item) };
}
