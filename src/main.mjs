import { getConfig } from "./config.mjs";
import { createDashboardServer } from "./http-server.mjs";
import { ensureDedicatedCodex } from "./launcher.mjs";
import { CodexInjector } from "./injector.mjs";
import { CodexTaskAdapter } from "./task-adapter.mjs";
import { ZoteroAdapter } from "./zotero-adapter.mjs";
import { ZoteroCredentialStore } from "./zotero-credentials.mjs";
import { ZoteroLocalApi } from "./zotero-local-api.mjs";
import { DispatchBoardStore } from "./dispatch-board.mjs";
import { CodexCliDispatcher, DispatchScheduler } from "./dispatcher.mjs";
import { ContextWindowStore, ModelCatalog } from "./context-window.mjs";
import { prepareWrapperCodexHome } from "./wrapper-codex-home.mjs";
import { orderWrapperProjectState } from "./wrapper-project-state.mjs";
import { AppServerProjectOrder } from "./app-server-project-order.mjs";
import { loadPeerConfig } from "./peer-config.mjs";
import { SshPeerAdapter } from "./ssh-peer-adapter.mjs";
import { FederatedTaskAdapter } from "./federated-task-adapter.mjs";
import { RemoteMessageService } from "./remote-message-service.mjs";
import { NativeConversationAdapter } from "./native-conversation-adapter.mjs";
import { NodeRuntimeService } from "./node-runtime.mjs";
import { SessionTitleIndex } from "./session-title-index.mjs";
import { NativeThreadStatusProvider } from "./native-thread-status.mjs";
import { NativeThreadSettingsAdapter } from "./native-thread-settings-adapter.mjs";
import { RemoteThreadSettingsService } from "./thread-settings-control.mjs";
import { SessionSettingsIndex } from "./session-settings-index.mjs";
import { NativeWriterLocator } from "./native-writer-locator.mjs";
import { NativeDesktopRouter } from "./native-desktop-router.mjs";
import { NativeOwnerInjector } from "./native-owner-injector.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function run() {
  const config = getConfig();
  const contextWindowStore = new ContextWindowStore({ filePath: path.join(sourceDirectory, ".runtime", "context-windows.json") });
  await contextWindowStore.init();
  const sessionSettingsIndex = new SessionSettingsIndex({ filePath: path.join(sourceDirectory, ".runtime", "session-settings-index.json") });
  await sessionSettingsIndex.init();
  const modelCatalog = new ModelCatalog({ filePath: config.modelCatalogPath });
  const wrapper = await prepareWrapperCodexHome({
    sourceHome: config.sourceCodexHome,
    wrapperHome: config.wrapperCodexHome,
    contextWindow: config.perThreadContextWindow
  });
  const nativeConversationAdapter = new NativeConversationAdapter({ cdpOrigin: config.cdpOrigin });
  const writerLocator = new NativeWriterLocator({ config });
  const nativeDesktopRouter = new NativeDesktopRouter({ writerLocator });
  const nativeThreadSettingsAdapter = new NativeThreadSettingsAdapter({ router: nativeDesktopRouter });
  const runtimeStatusProvider = new NativeThreadStatusProvider({ desktopBridge: nativeConversationAdapter });
  const localAdapter = new CodexTaskAdapter({
    sessionRoot: config.sessionRoot,
    archivedSessionRoot: config.archivedSessionRoot,
    titleIndex: new SessionTitleIndex({ filePath: config.sessionTitleIndexPath }),
    runtimeStatusProvider,
    contextWindowStore,
    sessionSettingsIndex,
    device: config.nodeDevice
  });
  const projectOrder = new AppServerProjectOrder({
    codexPath: path.join(config.appPath, "Contents", "Resources", "codex"),
    codexHome: config.wrapperCodexHome
  });
  try {
    const taskSnapshot = await localAdapter.listTasks();
    const orderResult = await projectOrder.apply(taskSnapshot.tasks || []);
    await orderWrapperProjectState({
      wrapperHome: config.wrapperCodexHome,
      serverProjectIds: orderResult.order.map((project) => project.id)
    });
    console.log(`[codex-control-console] native project priority order: ${orderResult.changed ? `${orderResult.moveCount} moves` : "unchanged"}`);
  } catch (error) {
    console.warn(`[codex-control-console] native project priority order unavailable: ${error.message}`);
  }
  const peers = await loadPeerConfig(config.peerConfigPath);
  const peerAdapters = peers.map((peer) => new SshPeerAdapter({ peer, actionKeyPath: path.join(config.peerActionKeyDirectory, `${peer.id}.key`) }));
  const adapter = new FederatedTaskAdapter({ localAdapter, peerAdapters });
  const zoteroAdapter = new ZoteroAdapter({ databasePath: config.zoteroPath });
  const zoteroCredentials = new ZoteroCredentialStore({ filePath: config.zoteroCredentialPath });
  const zoteroLocalApi = new ZoteroLocalApi({
    baseUrl: config.zoteroLocalApiOrigin,
    credentialStore: zoteroCredentials
  });
  const dispatchStore = new DispatchBoardStore({ filePath: path.join(sourceDirectory, ".runtime", "dispatch-board.json") });
  await dispatchStore.init();
  const dispatcher = new CodexCliDispatcher({
    codexPath: path.join(config.appPath, "Contents", "Resources", "codex"),
    codexHome: config.wrapperCodexHome,
    contextWindowStore
  });
  const nodeRuntimeService = new NodeRuntimeService({ nativeConversationAdapter });
  const remoteMessageService = new RemoteMessageService({ localAdapter, nativeConversationAdapter });
  const remoteThreadSettingsService = new RemoteThreadSettingsService({
    localAdapter,
    nativeAdapter: nativeThreadSettingsAdapter,
    contextWindowStore,
    modelCatalog,
    contextWindow: config.perThreadContextWindow
  });
  const scheduler = new DispatchScheduler({ store: dispatchStore, dispatcher });
  const dashboard = createDashboardServer({ config, adapter, local: localAdapter, remoteMessageService, remoteThreadSettingsService, nodeRuntimeService, zoteroAdapter, zoteroLocalApi, dispatchStore, contextWindowStore, modelCatalog });
  await dashboard.listen();
  let injector;
  let nativeOwnerInjector = null;
  try {
    const codex = await ensureDedicatedCodex(config);
    injector = new CodexInjector({
      cdpOrigin: config.cdpOrigin,
      dashboardUrl: config.dashboardOrigin,
      contextWindowStore
    });
    await injector.start();
    if (config.primaryCdpEnabled) {
      nativeOwnerInjector = new NativeOwnerInjector({ cdpOrigin: config.primaryCdpOrigin, contextWindowStore });
      await nativeOwnerInjector.start();
    }
    scheduler.start();
    console.log(`[codex-control-console] dashboard listening at ${config.dashboardOrigin}`);
    console.log(`[codex-control-console] CDP ${codex.mode} on ${config.cdpOrigin}`);
    console.log(`[codex-control-console] dedicated profile: ${config.profileDirectory}`);
    console.log(`[codex-control-console] wrapper CODEX_HOME: ${wrapper.wrapperHome}`);
    console.log("[codex-control-console] regular-chat context: model default");
    console.log(`[codex-control-console] per-thread extended context request: ${wrapper.requestedContextWindow}`);
  } catch (error) {
    zoteroAdapter.close();
    await dashboard.close();
    throw error;
  }

  const shutdown = async () => {
    await injector.stop();
    await nativeOwnerInjector?.stop();
    scheduler.stop();
    zoteroAdapter.close();
    await dashboard.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  return { config, dashboard, injector, nativeOwnerInjector, zoteroAdapter, zoteroLocalApi };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error) => {
    console.error(`[codex-control-console] ${error.message}`);
    process.exitCode = 1;
  });
}
