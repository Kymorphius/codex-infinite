import { getConfig } from './config.mjs';
import { GptContextCatalog } from './gpt-context-catalog.mjs';
import { HermesSharedSource } from './hermes-shared-source.mjs';
import { NativeConversationAdapter } from './native-conversation-adapter.mjs';
import { RemoteMessageService } from './remote-message-service.mjs';

export function createHermesSharedServices() {
  const config = getConfig();
  const catalog = new GptContextCatalog({ databasePath: config.threadStateDatabasePath,
    sessionRoots: [config.sessionRoot, config.archivedSessionRoot], titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice });
  const native = new NativeConversationAdapter({ cdpOrigin: `http://${config.cdpHost}:${config.cdpPort}` });
  const localAdapter = { getTask: async id => (await catalog.snapshot()).conversations.find(item => item.id === id && !item.internal) };
  const source = new HermesSharedSource({ catalog, nativeConversationAdapter: native,
    remoteMessageService: new RemoteMessageService({ localAdapter, nativeConversationAdapter: native }) });
  return { source, native, catalog, device: config.nodeDevice };
}
