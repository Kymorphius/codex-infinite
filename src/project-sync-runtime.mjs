import path from 'node:path';
import { LocalProjectReplicaAdapter } from './local-project-replica-adapter.mjs';
import { NativeProjectRegistration } from './native-project-registration.mjs';
import { ProjectIdentityStore } from './project-identity-store.mjs';
import { SshProjectSyncAdapter } from './ssh-project-sync-adapter.mjs';
import { ProjectReplicaService } from './project-replica-service.mjs';
import { syncError } from './project-sync-contract.mjs';

export function createProjectSyncRuntime({ config, nativeSidebarAdapter, nativeConversationAdapter, localAdapter, peers, nativeProjectRegistrar = null }) {
  const registrar = nativeProjectRegistrar || new NativeProjectRegistration({ cdpOrigin: config.cdpOrigin, sidebar: nativeSidebarAdapter });
  const localProjectSyncAdapter = new LocalProjectReplicaAdapter({
    creationRoots: config.projectCopyRoots || [],
    receiptDirectory: config.wrapperCodexHome ? path.join(config.wrapperCodexHome, 'project-replica-receipts') : null,
    registrar,
    identityStore: config.wrapperCodexHome ? new ProjectIdentityStore({ filePath: path.join(config.wrapperCodexHome, 'project-identities.json') }) : null,
    projectProvider: async () => {
      try { return (await registrar.catalog()).map(({ path, name }) => ({ path, name })); }
      catch { /* Preserve existing sync on native versions without the project registry API. */ }
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
  const projectSyncService = new ProjectReplicaService({
    localAdapter: localProjectSyncAdapter, localDevice: config.nodeDevice,
    peers: peers.map(peer => new SshProjectSyncAdapter({ peer, actionKeyPath: path.join(config.peerActionKeyDirectory, `${peer.id}.key`) }))
  });
  return { localProjectSyncAdapter, projectSyncService };
}
