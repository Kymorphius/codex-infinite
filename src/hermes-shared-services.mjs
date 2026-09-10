import { getConfig } from './config.mjs';
import { GptContextCatalog } from './gpt-context-catalog.mjs';
import { HermesSharedSource } from './hermes-shared-source.mjs';
import { NativeConversationAdapter } from './native-conversation-adapter.mjs';
import { RemoteMessageService } from './remote-message-service.mjs';
import { HermesNativeOperations } from './hermes-native-operations.mjs';
import { NativeThreadSettingsAdapter } from './native-thread-settings-adapter.mjs';

export function createHermesSharedServices() {
  const config = getConfig();
  const catalog = new GptContextCatalog({ databasePath: config.threadStateDatabasePath,
    sessionRoots: [config.sessionRoot, config.archivedSessionRoot], titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice });
  const native = new NativeConversationAdapter({ cdpOrigin: `http://${config.cdpHost}:${config.cdpPort}` });
  const localAdapter = { getTask: async id => (await catalog.snapshot()).conversations.find(item => item.id === id && !item.internal) };
  const source = new HermesSharedSource({ catalog, nativeConversationAdapter: native,
    remoteMessageService: new RemoteMessageService({ localAdapter, nativeConversationAdapter: native }) });
  const operations = new HermesNativeOperations({ source, native,
    settingsAdapter: new NativeThreadSettingsAdapter({ cdpOrigin: `http://${config.cdpHost}:${config.cdpPort}` }) });
  source.readNativeThread = threadId => operations.request('thread/read', { threadId, includeTurns: true });
  return { source, native, catalog, operations, device: config.nodeDevice };
}
