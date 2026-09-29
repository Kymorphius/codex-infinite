import { TerminalService } from './terminal-service.mjs';
import { TerminalConversationService } from './terminal-conversation-service.mjs';
import { createClaudeCompanionSource } from './claude-companion-source.mjs';
import { createRouterCompanionClient } from './router-companion-client.mjs';
import { createTerminalProjectValidator } from './terminal-project-adapter.mjs';
import { attachTerminalWebSocket } from './terminal-websocket.mjs';
import { NativeExperimentAdapter } from './native-experiment-adapter.mjs';
import { ExperimentService } from './experiment-service.mjs';
import { NativeSidebarAdapter } from './native-sidebar-adapter.mjs';
import { SidebarFederationService } from './sidebar-federation.mjs';
import { ProjectChecklistStore } from './project-checklist-store.mjs';
import { createTaskCenterRuntime } from './task-center-runtime.mjs';
import { TurnAnnotationStore } from './turn-annotation-store.mjs';
import { RuntimeRestartService } from "./runtime-restart.mjs";
import { NativeAppLaunchService } from "./native-app-launch.mjs";
import { NativeDashboardLaunchService } from "./native-dashboard-launch.mjs";
import { AttentionConversationService } from "./attention-conversation-service.mjs";
import { createComposerDraftReader } from "./native-composer-drafts.mjs";
import { RecentSentConversationService } from "./recent-sent-conversation-service.mjs";
import { RestartMarkService } from "./restart-mark-service.mjs";
import { RestartMarkStore } from "./restart-mark-store.mjs";
import { createAppInstanceReader } from "./app-instance.mjs";
import { createNativeRestartMarksBinding } from "./native-restart-marks.mjs";
import { GptContextCatalog } from './gpt-context-catalog.mjs';
import { createDiscussionRuntime } from './discussion-runtime.mjs';
import { SentMessageSearchService } from './sent-message-search-service.mjs';
import { resolveRipgrepPath } from './ripgrep-path.mjs';
import { withTerminalSentSearch } from './sent-message-search-composite.mjs';
import { SentMessageIndex } from './sent-message-index.mjs';
import { NativeThreadReadStateAdapter } from "./native-thread-read-state.mjs";
import { NewProjectService } from "./new-project-service.mjs";
import { getConfig } from "./config.mjs";
import { createDashboardServer } from "./http-server.mjs";
import { PersonalPanelTaskAdapter } from './personal-panel-task-adapter.mjs';
import { ensureDedicatedCodex, inspectDedicatedCodex } from "./launcher.mjs";
import { CodexInjector } from "./injector.mjs";
import { CodexTaskAdapter } from "./task-adapter.mjs";
import { ZoteroAdapter } from "./zotero-adapter.mjs";
import { ZoteroCredentialStore } from "./zotero-credentials.mjs";
import { ZoteroLocalApi } from "./zotero-local-api.mjs";
import { DispatchBoardStore } from "./dispatch-board.mjs";
import { DispatchAuditStore } from "./dispatch-audit.mjs";
import { CodexCliDispatcher, DispatchScheduler } from "./dispatcher.mjs";
import { GeneratorStore } from "./generator-store.mjs";
import { GeneratorService } from "./generator-service.mjs";
import { RuntimeDiagnosticsService } from "./runtime-diagnostics.mjs";
import { ContextWindowStore, ModelCatalog } from "./context-window.mjs";
import { prepareWrapperCodexHome } from "./wrapper-codex-home.mjs";
import { orderWrapperProjectState } from "./wrapper-project-state.mjs";
import { AppServerProjectOrder } from "./app-server-project-order.mjs";
import { loadPeerConfig } from "./peer-config.mjs";
import { resolveLocalManagerPeerRoutes } from "./localmanager-peer-directory.mjs";
import { SshPeerAdapter } from "./ssh-peer-adapter.mjs";
import { FederatedTaskAdapter } from "./federated-task-adapter.mjs";
import { RemoteMessageService } from "./remote-message-service.mjs";
import { NativeConversationAdapter } from "./native-conversation-adapter.mjs";
import { NodeRuntimeService } from "./node-runtime.mjs";
import { SessionTitleIndex, createCodexTitleLookup } from "./session-title-index.mjs";
import { NativeThreadStatusProvider } from "./native-thread-status.mjs";
import { NativeThreadSettingsAdapter } from "./native-thread-settings-adapter.mjs";
import { RemoteThreadSettingsService } from "./thread-settings-control.mjs";
import { SessionSettingsIndex } from "./session-settings-index.mjs";
import { NativeWriterLocator } from "./native-writer-locator.mjs";
import { CurrentProjectNameIndex } from "./current-project-names.mjs";
import { CurrentThreadProjectIndex } from "./current-thread-projects.mjs";
import { NativeDesktopRouter } from "./native-desktop-router.mjs";
import { NativeOwnerInjector } from "./native-owner-injector.mjs";
import { RouterTurnStateService } from "./router-turn-state-service.mjs";
import { TurboPolicyService, TurboPolicyStore } from "./turbo-policy.mjs";
import { createTurboRuntime } from "./turbo-runtime.mjs";
import { NativeSidebarLabelService } from "./native-sidebar-labels.mjs";
import { NativeRemoteSidebarService } from "./native-remote-sidebar.mjs";
import { WindowsProjectCopyAdapter } from "./windows-project-copy-adapter.mjs";
import { ProjectCopyService } from "./project-copy-service.mjs";
import { createProjectSyncRuntime } from './project-sync-runtime.mjs';
import { NativeProjectImportAdapter } from "./native-project-import-adapter.mjs";
import { NativeProjectSidebarRegistry } from "./native-project-sidebar-registry.mjs";
import { ProjectCopyReceiptStore } from "./project-copy-receipts.mjs";
import path from "node:path";
import { LocalSkillAdapter } from "./local-skill-adapter.mjs";
import { SkillSyncService } from "./skill-sync-service.mjs";
import { SkillConfigStore } from "./skill-config-store.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JevRoutingStore } from "./jev-routing-store.mjs";
import { JevThreadRoutingStore } from "./jev-thread-routing-store.mjs";
import { JevRoutingService } from "./jev-routing-service.mjs";
import { JevTransportModeManager } from "./jev-transport-mode.mjs";
import { JevTaskDispatcher } from "./jev-task-dispatcher.mjs";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

export async function run() {
  const config = getConfig();
  const contextWindowStore = new ContextWindowStore({ filePath: path.join(sourceDirectory, ".runtime", "context-windows.json") });
  await contextWindowStore.init();
  const sessionSettingsIndex = new SessionSettingsIndex({ filePath: path.join(sourceDirectory, ".runtime", "session-settings-index.json") });
  await sessionSettingsIndex.init();
  const modelCatalog = new ModelCatalog({ filePath: config.modelCatalogPath });
  const attachedCodex = await inspectDedicatedCodex(config);
  const wrapper = await prepareWrapperCodexHome({
    sourceHome: config.sourceCodexHome,
    wrapperHome: config.wrapperCodexHome,
    contextWindow: config.perThreadContextWindow,
    allowActiveRuntimeSidecars: Boolean(attachedCodex)
  });
  const nativeConversationAdapter = new NativeConversationAdapter({ cdpOrigin: config.cdpOrigin });
  const writerLocator = new NativeWriterLocator({ config });
  const nativeDesktopRouter = new NativeDesktopRouter({ writerLocator });
  const nativeThreadSettingsAdapter = new NativeThreadSettingsAdapter({ router: nativeDesktopRouter });
  const runtimeStatusProvider = new NativeThreadStatusProvider({ desktopBridge: nativeConversationAdapter });
  const projectNameIndex = new CurrentProjectNameIndex({ filePath: path.join(config.sourceCodexHome, ".codex-global-state.json") });
  const currentThreadProjectIndex = new CurrentThreadProjectIndex({ databasePath: config.threadStateDatabasePath });
  const localAdapter = new CodexTaskAdapter({
    sessionRoot: config.sessionRoot,
    archivedSessionRoot: config.archivedSessionRoot,
    titleIndex: new SessionTitleIndex({ filePath: config.sessionTitleIndexPath }),
    runtimeStatusProvider,
    contextWindowStore,
    sessionSettingsIndex,
    projectNameIndex,
    threadProjectIndex: currentThreadProjectIndex,
    device: config.nodeDevice
  });
  const projectOrder = new AppServerProjectOrder({
    codexPath: config.codexPath,
    codexHome: config.nativeCodexHome
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
  const configuredPeers = await loadPeerConfig(config.peerConfigPath);
  const peers = await resolveLocalManagerPeerRoutes(configuredPeers, { filePath: config.localManagerDeviceDirectoryPath });
  const peerAdapters = peers.map((peer) => new SshPeerAdapter({ peer, actionKeyPath: path.join(config.peerActionKeyDirectory, `${peer.id}.key`) }));
  const nativeSidebarAdapter = new NativeSidebarAdapter({ cdpOrigin: config.cdpOrigin, titleIndex: new SessionTitleIndex({ filePath: config.sessionTitleIndexPath }), taskAdapter: localAdapter });
  const sidebarService = new SidebarFederationService({ localAdapter: nativeSidebarAdapter, localDevice: config.nodeDevice, peers: peerAdapters });
  const projectSync = createProjectSyncRuntime({ config, nativeSidebarAdapter, nativeConversationAdapter, localAdapter, peers });
  const adapter = new FederatedTaskAdapter({ localAdapter, peerAdapters });
  const localSkillAdapter = new LocalSkillAdapter({
    node: config.nodeDevice,
    projectRootsProvider: async () => (await localAdapter.listTasks()).tasks,
    configStore: new SkillConfigStore({ filePaths: [path.join(config.sourceCodexHome, "config.toml"), path.join(config.wrapperCodexHome, "config.toml")] }),
    roots: [
      { scope: "codex-user", path: path.join(config.sourceCodexHome, "skills") },
      { scope: "agents-user", path: path.join(config.userHome, ".agents", "skills") }
    ]
  });
  const skillSyncService = new SkillSyncService({ localAdapter: localSkillAdapter, peerAdapters, localNode: config.nodeDevice });
  const projectCopyReceiptStore = new ProjectCopyReceiptStore({ filePath: path.join(config.wrapperCodexHome, "project-copy-receipts.json") });
  const nativeProjectSidebarRegistry = new NativeProjectSidebarRegistry({ homes: [config.sourceCodexHome, config.wrapperCodexHome] });
  const projectCopyService = new ProjectCopyService({
    taskAdapter: adapter,
    copyAdapters: peers.filter((peer) => peer.platform === "windows").map((peer) => new WindowsProjectCopyAdapter({ peer })),
    nativeImporter: new NativeProjectImportAdapter({ codexPath: config.codexPath, codexHome: config.sourceCodexHome, sessionRoot: config.sessionRoot, sidebarRegistry: nativeProjectSidebarRegistry }),
    receiptStore: projectCopyReceiptStore,
    allowedRoots: config.projectCopyRoots
  });
  const sidebarLabelService = new NativeSidebarLabelService({ adapter, localAdapter, currentThreadProjectIndex });
  const remoteSidebarService = new NativeRemoteSidebarService({ adapter });
  const newProjectService = new NewProjectService({ codexPath: config.codexPath, codexHome: config.nativeCodexHome, taskAdapter: localAdapter, statePath: path.join(config.wrapperCodexHome, "new-project-lifecycle.json"), projectStatePaths: [config.sourceCodexHome, config.wrapperCodexHome].map(home => path.join(home, ".codex-global-state.json")) });
  const sentMessageSearchService = new SentMessageSearchService({
    catalog: new GptContextCatalog({ databasePath: config.threadStateDatabasePath, sessionRoots: [config.sessionRoot], titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice }),
    index: new SentMessageIndex({ databasePath: path.join(config.wrapperCodexHome, 'sent-message-search.sqlite'), sessionRoots: [config.sessionRoot] }),
    resolveRipgrep: () => resolveRipgrepPath({ config })
  });
  void sentMessageSearchService.prepare().catch(error => console.warn(`[codex-control-console] sent message indexing unavailable: ${error.message}`));
  const attentionConversations = new AttentionConversationService({ taskAdapter: localAdapter, runtimeStatusProvider: nativeConversationAdapter, draftReader: createComposerDraftReader({ filePath: path.join(config.nativeCodexHome, ".codex-global-state.json") }), unreadStateProvider: new NativeThreadReadStateAdapter({ cdpOrigin: config.cdpOrigin }), archivedSessionRoot: config.archivedSessionRoot });
  const restartMarks = new RestartMarkService({ store: new RestartMarkStore({ filePath: path.join(config.wrapperCodexHome, "restart-marks.json") }), readAppInstance: createAppInstanceReader({ config }) });
  const recentSentConversations = new RecentSentConversationService({ taskAdapter: localAdapter, archivedSessionRoot: config.archivedSessionRoot });
  const primaryAttentionConversations = new AttentionConversationService({ taskAdapter: localAdapter, runtimeStatusProvider: new NativeConversationAdapter({ cdpOrigin: config.primaryCdpOrigin }), draftReader: createComposerDraftReader({ filePath: path.join(config.sourceCodexHome, ".codex-global-state.json") }), unreadStateProvider: new NativeThreadReadStateAdapter({ cdpOrigin: config.primaryCdpOrigin }), archivedSessionRoot: config.archivedSessionRoot });
  const turboPolicyStore = new TurboPolicyStore({ filePath: path.join(config.wrapperCodexHome, "turbo-policy.json") });
  await turboPolicyStore.init();
  const turboPolicyService = new TurboPolicyService({
    store: turboPolicyStore,
    modelCatalog,
    nodeId: config.nodeDevice.id,
    devices: [config.nodeDevice, ...peers]
  });
  await turboPolicyService.refreshCatalog();
  const zoteroAdapter = new ZoteroAdapter({ databasePath: config.zoteroPath });
  const zoteroCredentials = new ZoteroCredentialStore({ filePath: config.zoteroCredentialPath });
  const zoteroLocalApi = new ZoteroLocalApi({
    baseUrl: config.zoteroLocalApiOrigin,
    credentialStore: zoteroCredentials
  });
  const dispatchAuditStore = new DispatchAuditStore({ filePath: path.join(sourceDirectory, ".runtime", "dispatch-audit.jsonl") });
  const dispatchStore = new DispatchBoardStore({ filePath: path.join(sourceDirectory, ".runtime", "dispatch-board.json"), auditStore: dispatchAuditStore });
  await dispatchStore.init();
  const generatorStore = new GeneratorStore({ filePath: path.join(sourceDirectory, ".runtime", "generators.json") });
  await generatorStore.init();
  const generatorService = new GeneratorService({ store: generatorStore, dispatchStore });
  await generatorService.reconcile();
  const jevTaskDispatcher = new JevTaskDispatcher({ codexPath: config.codexPath, codexHome: config.nativeCodexHome });
  const jevRoutingService = new JevRoutingService({
    store: new JevRoutingStore({ filePath: config.jevRoutingPath }),
    threadStore: new JevThreadRoutingStore({ filePath: config.jevThreadRoutingPath }),
    transportManager: new JevTransportModeManager({ configPath: path.join(config.wrapperCodexHome, "config.toml"), callerSecretPath: config.routerCallerSecretPath }),
    receiptDirectory: config.jevRoutingReceiptsDirectory,
    jevPath: config.jevPath,
    taskDispatcher: jevTaskDispatcher
  });
  await jevRoutingService.initialize();
  const turboRuntime = createTurboRuntime({ config, localService: turboPolicyService, peerAdapters, routingService: jevRoutingService });
  const turboCoordinator = turboRuntime.coordinator;
  const dispatcher = new CodexCliDispatcher({
    codexPath: config.codexPath,
    codexHome: config.nativeCodexHome,
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
  const scheduler = new DispatchScheduler({ store: dispatchStore, dispatcher, generatorService });
  const diagnosticsService = new RuntimeDiagnosticsService({ nodeRuntimeService, dispatchStore, auditStore: dispatchAuditStore, scheduler });
  let injector;
  let nativeOwnerInjector = null;
  const turnStateService = new RouterTurnStateService({ origin: config.routerOrigin, callerSecretPath: config.routerCallerSecretPath });
  const terminalService = new TerminalService({ userHome: config.userHome, defaultCwd: config.userHome });
  const terminalConversations = new TerminalConversationService({ terminalService, deviceId: config.nodeDevice.id,
    filePath: path.join(config.wrapperCodexHome, 'terminal-conversations.json'), validateProject: createTerminalProjectValidator(nativeSidebarAdapter),
    companions: createClaudeCompanionSource({ routerStateDirectory: config.routerStateDirectory }), codexTitle: createCodexTitleLookup({ filePath: config.sessionTitleIndexPath }),
    companionCreator: createRouterCompanionClient({ origin: config.routerOrigin, callerSecretPath: config.routerCallerSecretPath }) });
  const discussions = createDiscussionRuntime({ config, terminalConversations, terminalService, localAdapter, remoteMessageService, catalog: new GptContextCatalog({ databasePath: config.threadStateDatabasePath, sessionRoots: [config.sessionRoot], titleIndexPath: config.sessionTitleIndexPath, device: config.nodeDevice }) });
  const restartService = new RuntimeRestartService({ config, prepare: async () => { await terminalService.dispose(); turboRuntime.stop(); await injector?.stop(); await nativeOwnerInjector?.stop(); await sentMessageSearchService.index?.close(); scheduler.stop(); } });
  const nativeAppLaunchService = new NativeAppLaunchService({ config });
  const nativeDashboardLaunchService = new NativeDashboardLaunchService({ restart: () => restartService.request(), launchOriginal: () => nativeAppLaunchService.launch() });
  const experimentService = new ExperimentService({ localAdapter: new NativeExperimentAdapter({ cdpOrigin: config.cdpOrigin }), localDevice: config.nodeDevice, peers });
  const checklistStore = new ProjectChecklistStore(path.join(config.wrapperCodexHome, 'project-checklists'));
  const taskCenter = createTaskCenterRuntime({ config, checklistStore, dispatchStore, adapter, peers, terminalConversations });
  const personalPanelTaskAdapter = new PersonalPanelTaskAdapter({ scriptPath: config.personalPanelTaskBridgePath });
  const dashboard = createDashboardServer({ config, terminalService, terminalConversations, discussions, taskCenter, experimentService, adapter, local: localAdapter, remoteMessageService, remoteThreadSettingsService, turboCoordinator, turboPolicyService, skillSyncService, localSkillAdapter, projectCopyService, projectSync, nodeRuntimeService, diagnosticsService, restartService, nativeAppLaunchService, zoteroAdapter, zoteroLocalApi, dispatchStore, checklistStore, generatorService, sidebarService, nativeSidebarAdapter, contextWindowStore, modelCatalog, jevRoutingService, personalPanelTaskAdapter });
  const detachTerminal = attachTerminalWebSocket({ server: dashboard.server, service: terminalService, dashboardOrigin: config.dashboardOrigin });
  try {
    await dashboard.listen();
    const codex = attachedCodex || await ensureDedicatedCodex(config);
    injector = new CodexInjector({
      checklistStore: taskCenter.projection,
      annotationStore: new TurnAnnotationStore(path.join(config.wrapperCodexHome, 'annotations')),
      cdpOrigin: config.cdpOrigin,
      dashboardUrl: config.dashboardOrigin,
      contextWindowStore,
      turboPolicyProvider: turboRuntime.policyProvider,
      turboController: turboCoordinator,
      jevRoutingService,
      sidebarLabelProvider: sidebarLabelService,
      remoteSidebarProvider: remoteSidebarService,
      newProjectProvider: newProjectService,
      sentMessageSearchService: withTerminalSentSearch(sentMessageSearchService, terminalConversations),
      attentionConversationProvider: attentionConversations,
      recentSentConversationProvider: recentSentConversations,
      turnStateProvider: turnStateService,
      recoverTarget: () => ensureDedicatedCodex(config),
      reloadAfterCspBypass: config.cspReloadRequired,
      terminalConversations, terminalService,
      dashboardLauncher: nativeDashboardLaunchService,
      extraBindings: [createNativeRestartMarksBinding(restartMarks)]
    });
    await injector.start();
    if (config.primaryCdpEnabled) {
      nativeOwnerInjector = new NativeOwnerInjector({ cdpOrigin: config.primaryCdpOrigin, contextWindowStore, turboPolicyProvider: turboRuntime.policyProvider, turboController: turboCoordinator, jevRoutingService, sidebarLabelProvider: sidebarLabelService, remoteSidebarProvider: remoteSidebarService, newProjectProvider: newProjectService, sentMessageSearchService, attentionConversationProvider: primaryAttentionConversations, turnStateProvider: turnStateService });
      await nativeOwnerInjector.start();
    }
    scheduler.start();
    void turboRuntime.start();
    console.log(`[codex-control-console] dashboard listening at ${config.dashboardOrigin}`);
    console.log(`[codex-control-console] CDP ${codex.mode} on ${config.cdpOrigin}`);
    console.log(`[codex-control-console] dedicated profile: ${config.profileDirectory}`);
    console.log(`[codex-control-console] wrapper CODEX_HOME: ${wrapper.wrapperHome}`);
    console.log("[codex-control-console] regular-chat context: model default");
    console.log(`[codex-control-console] per-thread extended context request: ${wrapper.requestedContextWindow}`);
  } catch (error) {
    detachTerminal();
    await terminalService.dispose();
    turboRuntime.stop();
    await sentMessageSearchService.index?.close();
    zoteroAdapter.close();
    await dashboard.close();
    throw error;
  }

  const shutdown = async () => {
    detachTerminal();
    await terminalService.dispose();
    turboRuntime.stop();
    jevTaskDispatcher.close();
    await injector.stop();
    await nativeOwnerInjector?.stop();
    await sentMessageSearchService.index?.close();
    scheduler.stop();
    zoteroAdapter.close();
    await dashboard.close();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  return { config, dashboard, injector, nativeOwnerInjector, zoteroAdapter, zoteroLocalApi };
}

export function isMainModuleUrl(moduleUrl, entryPath) {
  return Boolean(entryPath) && moduleUrl === pathToFileURL(entryPath).href;
}

if (isMainModuleUrl(import.meta.url, process.argv[1])) {
  run().catch((error) => {
    console.error(`[codex-control-console] ${error.message}`);
    process.exitCode = 1;
  });
}
