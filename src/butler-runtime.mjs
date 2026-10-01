import path from 'node:path';
import { ButlerWorkspace } from './butler-workspace.mjs';

export function butlerCwdFor(config) { return path.join(config.wrapperCodexHome, 'butler'); }

// Composition helper: the butler reads the same service instances the console already runs.
export function createButlerWorkspace({ config, adapter, terminalConversations = null, attention = null, ...options }) {
  return new ButlerWorkspace({
    cwd: butlerCwdFor(config),
    sessionRoots: [config.sessionRoot, config.archivedSessionRoot].filter(Boolean),
    archivedSessionRoot: config.archivedSessionRoot,
    read: async () => {
      const [snapshot, terminal, attentionSnapshot] = await Promise.all([
        adapter.listTasks(),
        terminalConversations ? terminalConversations.list().catch(() => null) : null,
        attention ? attention.read().catch(() => null) : null
      ]);
      return { tasks: snapshot?.tasks || [], devices: snapshot?.devices || [], terminalConversations: terminal, attention: attentionSnapshot, localDeviceId: config.nodeDevice?.id || '' };
    },
    ...options
  });
}
