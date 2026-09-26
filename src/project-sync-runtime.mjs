import path from 'node:path';
import { LocalProjectSyncAdapter } from './local-project-sync-adapter.mjs';
import { SshProjectSyncAdapter } from './ssh-project-sync-adapter.mjs';
import { ProjectSyncService } from './project-sync-service.mjs';
import { syncError } from './project-sync-contract.mjs';

export function createProjectSyncRuntime({ config, nativeSidebarAdapter, nativeConversationAdapter, localAdapter, peers }) {
  const localProjectSyncAdapter = new LocalProjectSyncAdapter({
    projectProvider: async () => {
      const snapshot = await nativeSidebarAdapter.read();
      const projects = new Map();
      for (const project of snapshot.projects) {
        if (project.source !== 'codex' || project.sourceDirectories?.length !== 1) continue;
        const directory = project.sourceDirectories[0];
        if (!projects.has(directory)) projects.set(directory, { path: directory, name: project.name || path.basename(directory) });
      }
      return [...projects.values()];
    },
    taskProvider: async () => {
      let statuses;
      try { statuses = await nativeConversationAdapter.readThreadStatuses({ strict: true }); }
      catch { throw syncError('无法读取原生运行状态，请恢复设备窗口后重新预检', 503); }
      if (!(statuses instanceof Map)) throw syncError('无法确认原生任务状态，请重新预检', 503);
      const snapshot = await localAdapter.listTasks();
      if (!['connected', 'empty'].includes(snapshot.status) || !Array.isArray(snapshot.tasks)) {
        throw syncError('无法确认本机任务状态，请恢复连接后重新预检', 503);
      }
      const tasks = snapshot.tasks.map(task => ({ ...task, status: statuses.get(task.id) || task.status }));
      const known = new Set(tasks.map(task => task.id));
      for (const [id, status] of statuses) if (status === 'active' && !known.has(id)) tasks.push({ id, status, cwd: null });
      return tasks;
    }
  });
  const projectSyncService = new ProjectSyncService({
    localAdapter: localProjectSyncAdapter, localDevice: config.nodeDevice,
    peers: peers.map(peer => new SshProjectSyncAdapter({ peer, actionKeyPath: path.join(config.peerActionKeyDirectory, `${peer.id}.key`) }))
  });
  return { localProjectSyncAdapter, projectSyncService };
}
