import { normalizeNativeRemoteSidebarItems } from './native-remote-sidebar-contract.mjs';

export function mergeProjectSearchCatalog(local = { projects: [], stale: true }, remote = []) {
  const projects = (Array.isArray(local?.projects) ? local.projects : []).map(project => ({
    ...project, searchKey: JSON.stringify(['local', project.id]), device: { kind: 'local-codex', name: '本机', status: 'connected' }
  }));
  const seen = new Set();
  for (const device of normalizeNativeRemoteSidebarItems(remote)) {
    for (const project of device.projects) {
      const searchKey = JSON.stringify(['remote', device.id, project.key]);
      if (seen.has(searchKey)) continue;
      seen.add(searchKey);
      projects.push({ id: project.key, searchKey, name: project.name,
        sourceDirectory: project.sourceDirectory, sourceDirectories: project.sourceDirectories,
        device: { id: device.id, name: device.name, kind: 'remote-codex', status: device.status },
        tasks: project.conversations.map(task => ({ id: task.id, title: task.title })),
        hiddenConversationCount: project.hiddenConversationCount
      });
    }
  }
  return { projects, stale: local?.stale !== false };
}
