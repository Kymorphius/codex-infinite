// Managed providers join presentation catalogs without entering native indexes.
export function projectTerminalConversations(snapshot, registry, localDevice, nativeProjects = []) {
  const conversations = registry?.conversations || [];
  const device = (snapshot.devices || []).find(value => value.id === registry.deviceId)
    || { ...localDevice, id: registry.deviceId, kind: 'local-codex', status: 'connected' };
  const projectName = conversation => nativeProjects.find(project => project.key === conversation.projectRef?.key
    && project.id === conversation.projectRef?.id && project.source === conversation.projectRef?.source
    && project.hostId === conversation.projectRef?.hostId)?.name
    || conversation.cwd.split(/[\\/]/).filter(Boolean).at(-1) || '未归类';
  const terminalTasks = conversations.filter(value => !value.archived).map(conversation => ({
    id: conversation.id, provider: 'terminal', title: conversation.title, cwd: conversation.cwd,
    project: projectName(conversation), projectDisplayName: projectName(conversation),
    createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
    status: 'unknown', boardStatus: 'pending', model: null, reasoningEffort: null,
    device, terminalConversation: conversation,
    capabilities: ['open', 'rename', 'pin', 'archive', 'manual-input', 'task-center'],
  }));
  const tasks = [...(snapshot.tasks || []), ...terminalTasks];
  const devices = [...(snapshot.devices || [])];
  if (terminalTasks.length && !devices.some(value => value.id === device.id)) devices.push(device);
  return { ...snapshot, tasks, devices, terminalConversations: conversations,
    status: tasks.length ? 'connected' : snapshot.status };
}
