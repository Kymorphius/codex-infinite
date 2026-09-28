import { buildNativeUnifiedSidebarInjectionScript } from './native-unified-sidebar.mjs';
import { buildNativeClaudePreviewInjectionScript } from './native-claude-preview.mjs';
import { syncProjectChecklist } from './project-checklist-sync.mjs';
import { createProjectChecklistSyncWake, PROJECT_CHECKLIST_SYNC_BINDING } from './project-checklist-sync-wake.mjs';
import { syncTurnAnnotations } from './turn-annotation-sync.mjs';
import { buildNativeSidebarRestartInjectionScript } from "./native-sidebar-restart.mjs";
import { buildNativePinnedEmptyInjectionScript } from "./native-pinned-empty.mjs";
import { mergeProjectSearchCatalog } from "./federated-project-search.mjs";
import { buildNativeProjectPathMenuScript } from "./native-project-path-menu.mjs";
import { buildNativeProjectSearchInjectionScript, buildNativeProjectSearchSnapshotScript } from "./native-project-search.mjs";
import { buildNativeSentMessageSearchInjectionScript, respondToSentMessageSearch, SENT_MESSAGE_SEARCH_BINDING } from './native-sent-message-search.mjs';
import { buildNativeAttentionConversationsInjectionScript, buildNativeAttentionConversationsSnapshotScript } from "./native-attention-conversations.mjs";
import { buildNativeRecentSentSnapshotScript } from "./native-recent-sent-conversations.mjs";
import { buildNativeNewProjectsInjectionScript, buildNativeNewProjectsSnapshotScript } from "./native-new-projects.mjs";
import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { buildInjectionScript } from "./injection.mjs";
import { buildNativeApprovalInjectionScript } from "./native-approval-injection.mjs";
import {
  buildNativeContextInjectionScript,
  buildNativeContextSnapshotScript,
  NATIVE_CONTEXT_BINDING,
  normalizeNativeContextAction
} from "./native-context-injection.mjs";
import { respondToNativeTurboBinding, buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript, NATIVE_TURBO_BINDING } from "./native-turbo-injection.mjs";
import { buildNativeJevRoutingInjectionScript, buildNativeJevRoutingSnapshotScript, NATIVE_JEV_ROUTING_BINDING, respondToNativeJevRoutingBinding } from "./native-jev-routing.mjs";
import { buildNativeSidebarLabelsInjectionScript, buildNativeSidebarLabelsSnapshotScript } from "./native-sidebar-labels.mjs";
import { buildNativeSidebarActivityInjectionScript } from "./native-sidebar-activity.mjs";
import { buildNativeRemoteSidebarInjectionScript, buildNativeRemoteSidebarSnapshotScript } from "./native-remote-sidebar.mjs";
import { buildNativeAttentionStickyInjectionScript } from "./native-attention-sticky.mjs";
import { buildNativeChatgptChatSectionInjectionScript } from "./native-chatgpt-chat-section.mjs";
import { buildNativeOpenLocalProjectInjectionScript } from "./native-open-local-project.mjs";
import { buildNativeComposerHeldQueueInjectionScript } from "./native-composer-held-queue.mjs";
import { buildNativeComposerControlOrderSource } from "./native-composer-control-order.mjs";
import { buildNativeLongConversationInjectionScript } from "./native-long-conversation.mjs";
import { buildNativeTurnStateInjectionScript, buildNativeTurnStateSnapshotScript } from "./native-turn-state-status.mjs";
import { deferNativeDocumentSource, waitForReloadedNativeDocument } from "./native-document-bootstrap.mjs";
import { NATIVE_DASHBOARD_BINDING } from "./native-dashboard-launch.mjs";
import { installNativeTerminalBinding } from './native-terminal-binding.mjs';
import { prepareNativeTerminalRuntime } from './native-terminal-runtime.mjs';
import { prepareNativeCspBypass } from "./native-csp-bypass.mjs";

export async function persistNativeContextAction(payload, contextWindowStore) {
  if (!contextWindowStore) return null;
  let parsed;
  try { parsed = JSON.parse(String(payload || "")); } catch { return null; }
  const action = normalizeNativeContextAction(parsed);
  if (!action) return null;
  if (action.action === "set") await contextWindowStore.set(action.threadId, action.contextWindow);
  else await contextWindowStore.remove(action.threadId);
  return action;
}

export async function drainNativeContextActions(connection, contextWindowStore) {
  if (!contextWindowStore) return [];
  const raw = await connection.evaluate("window.__codexControlConsoleDrainContextActions?.() || []").catch(() => []);
  const actions = (Array.isArray(raw) ? raw : []).slice(0, 32).map(normalizeNativeContextAction).filter(Boolean);
  for (const action of actions) {
    if (action.action === "set") await contextWindowStore.set(action.threadId, action.contextWindow);
    else await contextWindowStore.remove(action.threadId);
  }
  return actions;
}

async function syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, jevRouting, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch, turnStateSnapshot, recentSentConversations) {
  await connection.evaluate(buildNativeApprovalInjectionScript());
  await connection.evaluate(buildNativeContextInjectionScript());
  await drainNativeContextActions(connection, contextWindowStore);
  await connection.evaluate(buildNativeContextSnapshotScript(contextWindowStore?.list?.() || contextOverrides));
  await connection.evaluate(buildNativeJevRoutingInjectionScript());
  await connection.evaluate(buildNativeClaudePreviewInjectionScript());
  await connection.evaluate(buildNativeJevRoutingSnapshotScript(jevRouting));
  await connection.evaluate(buildNativeTurboInjectionScript());
  await connection.evaluate(buildNativeTurboSnapshotScript(turboPolicy));
  await connection.evaluate(buildNativeSidebarLabelsInjectionScript());
  await connection.evaluate(buildNativeSidebarActivityInjectionScript());
  await connection.evaluate(buildNativeSidebarLabelsSnapshotScript(sidebarLabels));
  await connection.evaluate(buildNativeRemoteSidebarInjectionScript());
  await connection.evaluate(buildNativeRemoteSidebarSnapshotScript(remoteSidebar));
  await connection.evaluate(buildNativeAttentionStickyInjectionScript());
  await connection.evaluate(buildNativeChatgptChatSectionInjectionScript());
  await connection.evaluate(buildNativeOpenLocalProjectInjectionScript());
  await connection.evaluate(buildNativeComposerHeldQueueInjectionScript());
  await connection.evaluate(`(() => { ${buildNativeComposerControlOrderSource()} })()`);
  await connection.evaluate(buildNativeLongConversationInjectionScript());
  await connection.evaluate(buildNativeTurnStateInjectionScript());
  await connection.evaluate(buildNativeTurnStateSnapshotScript(turnStateSnapshot));
  await connection.evaluate(buildNativeNewProjectsInjectionScript());
  await connection.evaluate(buildNativeNewProjectsSnapshotScript(newProjects));
  await connection.evaluate(buildNativeAttentionConversationsInjectionScript());
  await connection.evaluate(buildNativeAttentionConversationsSnapshotScript(attentionConversations));
  await connection.evaluate(buildNativeRecentSentSnapshotScript(recentSentConversations));
  await connection.evaluate(buildNativePinnedEmptyInjectionScript());
  await connection.evaluate(buildNativeProjectSearchInjectionScript());
  await connection.evaluate(buildNativeSentMessageSearchInjectionScript());
  const search = mergeProjectSearchCatalog(projectSearch, remoteSidebar);
  await connection.evaluate(buildNativeProjectSearchSnapshotScript(search));
  await connection.evaluate(buildNativeProjectPathMenuScript([...(projectSearch?.projects || []), ...search.projects]));
}

export async function installIntoTarget(connection, dashboardUrl, { force = false, contextOverrides = [], contextWindowStore = null, turboPolicy = null, jevRouting = null, sidebarLabels = [], remoteSidebar = [], newProjects = [], attentionConversations = undefined, projectSearch = undefined, turnStateSnapshot = undefined, recentSentConversations = undefined, reloadAfterCspBypass = true, standaloneDashboardBinding = "", hostActionBinding = standaloneDashboardBinding } = {}) {
  await connection.send("Page.enable");
  if (!connection.__codexControlConsoleScriptsPrepared) {
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.__codexControlConsoleCspDocumentPrepared = true;"
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeContextInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeApprovalInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeJevRoutingInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeTurboInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeSidebarLabelsInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeSidebarActivityInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeRemoteSidebarInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeAttentionStickyInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeChatgptChatSectionInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: deferNativeDocumentSource(buildNativeOpenLocalProjectInjectionScript())
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(`(() => { ${buildNativeComposerControlOrderSource()} })()`) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeLongConversationInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeTurnStateInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeNewProjectsInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeAttentionConversationsInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeProjectSearchInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativeSentMessageSearchInjectionScript()) });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(buildNativePinnedEmptyInjectionScript()) });
    connection.__codexControlConsoleScriptsPrepared = true;
  }
  if (!standaloneDashboardBinding) {
    await prepareNativeCspBypass(connection, { reloadAfterCspBypass });
    await connection.evaluate(buildNativeUnifiedSidebarInjectionScript(dashboardUrl));
  }
  await connection.evaluate(buildNativeSidebarRestartInjectionScript(dashboardUrl, hostActionBinding));
  if (!force && connection.__codexControlConsoleInstalled) {
    const state = await connection.evaluate(`(() => {
      const entry = document.querySelector('[data-codex-control-console-entry]');
      const frame = document.querySelector('[data-codex-control-console-frame]');
      const frameRecoveryManaged = Boolean(frame && document.querySelector('[data-codex-control-console-frame-loading]'));
      const frameRecoveryRequest = frame?.getAttribute('data-codex-control-console-frame-recovery-request') || document.body?.getAttribute('data-codex-control-console-frame-recovery-request') || '';
      return { hasEntry: Boolean(entry), hasFrame: Boolean(frame), frameReady: Boolean(frame?.hasAttribute('data-codex-control-console-frame-ready')), frameRecoveryManaged, frameRecoveryRequest };
    })()`).catch(() => ({ hasEntry: false, hasFrame: false, frameReady: false, frameRecoveryManaged: false, frameRecoveryRequest: '' }));
    if (state.frameRecoveryRequest && state.frameRecoveryRequest !== connection.__codexControlConsoleFrameRecoveryRequest) {
      connection.__codexControlConsoleFrameRecoveryRequest = state.frameRecoveryRequest;
      if (reloadAfterCspBypass) {
        await connection.send("Page.reload", { ignoreCache: false });
        await waitForReloadedNativeDocument(connection, connection.__codexControlConsoleCspDocumentToken);
      }
    }
    if (state.frameRecoveryManaged) connection.__codexControlConsoleRecoveryAttempted = false;
    if (state.hasEntry && (!state.hasFrame || state.frameReady || state.frameRecoveryManaged || connection.__codexControlConsoleRecoveryAttempted)) {
      await syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, jevRouting, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch, turnStateSnapshot, recentSentConversations);
      await connection.evaluate(buildInjectionScript(dashboardUrl, { standaloneDashboardBinding }));
      return { status: "already-installed" };
    }
    if (state.hasEntry && state.hasFrame && !state.frameReady) {
      await connection.evaluate("window.__codexControlConsoleClose?.()");
      connection.__codexControlConsoleRecoveryAttempted = true;
    }
  }
  await syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, jevRouting, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch, turnStateSnapshot, recentSentConversations);
  await connection.evaluate(buildInjectionScript(dashboardUrl, { standaloneDashboardBinding }));
  connection.__codexControlConsoleInstalled = true;
  return { status: "installed" };
}

export class CodexInjector {
  constructor({ cdpOrigin, dashboardUrl, checklistStore = null, annotationStore = null, contextWindowStore = null, turboPolicyProvider = null, turboController = null, jevRoutingService = null, sidebarLabelProvider = null, remoteSidebarProvider = null, newProjectProvider = null, sentMessageSearchService = null, attentionConversationProvider = null, recentSentConversationProvider = null, turnStateProvider = null, recoverTarget = null, reloadAfterCspBypass = true, dashboardLauncher = null, terminalConversations = null, terminalService = null, pollMs = 1200, logger = console }) {
    this.annotationStore = annotationStore;
    this.checklistStore = checklistStore;
    this.cdpOrigin = cdpOrigin;
    this.dashboardUrl = dashboardUrl;
    this.pollMs = pollMs;
    this.logger = logger;
    this.contextWindowStore = contextWindowStore;
    this.turboPolicyProvider = turboPolicyProvider;
    this.turboController = turboController;
    this.jevRoutingService = jevRoutingService;
    this.sidebarLabelProvider = sidebarLabelProvider;
    this.remoteSidebarProvider = remoteSidebarProvider;
    this.newProjectProvider = newProjectProvider;
    this.sentMessageSearchService = sentMessageSearchService;
    this.attentionConversationProvider = attentionConversationProvider;
    this.recentSentConversationProvider = recentSentConversationProvider;
    this.turnStateProvider = turnStateProvider;
    this.recoverTarget = recoverTarget;
    this.reloadAfterCspBypass = reloadAfterCspBypass;
    this.dashboardLauncher = dashboardLauncher; this.terminalConversations = terminalConversations; this.terminalService = terminalService;
    this.running = false;
    this.timer = null;
    this.syncing = false;
    this.targetId = null;
    this.connection = null;
    this.removeContextBindingListener = null;
    this.contextActionChain = Promise.resolve();
    this.turboActionChain = Promise.resolve();
    this.jevActionChain = Promise.resolve();
    this.dashboardLaunchChain = Promise.resolve();
    this.checklistWake = createProjectChecklistSyncWake({
      canRun: () => this.running && !this.syncing && Boolean(this.connection && this.checklistStore),
      run: () => syncProjectChecklist(this.connection, this.checklistStore),
      onError: (error) => this.logger.warn(`[codex-control-console] checklist wake failed: ${error.message}`)
    });
  }

  async sync() {
    if (this.syncing || this.checklistWake.busy()) return;
    this.syncing = true;
    try {
      let targets;
      let target;
      try {
        targets = await discoverTargets(this.cdpOrigin);
        target = chooseMainTarget(targets);
      }
      catch (error) {
        if (!this.recoverTarget) throw error;
        await this.recoverTarget();
        targets = await discoverTargets(this.cdpOrigin);
        target = chooseMainTarget(targets);
      }
      if (target.id !== this.targetId) {
        this.removeTerminalBinding?.(); this.removeContextBindingListener?.();
        await this.connection?.close();
        this.connection = new CdpConnection(target.webSocketDebuggerUrl);
        await this.connection.connect();
        if (this.terminalConversations && !this.reloadAfterCspBypass) this.removeTerminalBinding = await installNativeTerminalBinding(this.connection, this.terminalConversations, this.terminalService);
        await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
        await this.connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
        await this.connection.send("Runtime.addBinding", { name: NATIVE_JEV_ROUTING_BINDING });
        if (this.dashboardLauncher) await this.connection.send("Runtime.addBinding", { name: NATIVE_DASHBOARD_BINDING });
        this.removeContextBindingListener = this.connection.onEvent((event) => {
          if (event.method !== "Runtime.bindingCalled") return;
          if (event.params?.name === NATIVE_CONTEXT_BINDING) {
            this.contextActionChain = this.contextActionChain
              .then(() => persistNativeContextAction(event.params.payload, this.contextWindowStore))
              .catch((error) => this.logger.warn(`[codex-control-console] context toggle persistence failed: ${error.message}`));
          } else if (event.params?.name === NATIVE_TURBO_BINDING) {
            const connection = this.connection;
            this.turboActionChain = this.turboActionChain
              .then(() => respondToNativeTurboBinding(event.params.payload, connection, this.turboController))
              .catch((error) => this.logger.warn(`[codex-control-console] Turbo toggle failed: ${error.message}`));
          } else if (event.params?.name === NATIVE_JEV_ROUTING_BINDING) {
            const connection = this.connection;
            this.jevActionChain = this.jevActionChain
              .then(() => respondToNativeJevRoutingBinding(event.params.payload, connection, this.jevRoutingService))
              .catch((error) => this.logger.warn(`[codex-control-console] Jev native routing failed: ${error.message}`));
          } else if (event.params?.name === NATIVE_DASHBOARD_BINDING && this.dashboardLauncher) {
            this.dashboardLaunchChain = this.dashboardLaunchChain
              .then(() => this.dashboardLauncher.open(event.params.payload))
              .catch((error) => this.logger.warn(`[codex-control-console] dashboard launch failed: ${error.message}`));
          } else if (event.params?.name === SENT_MESSAGE_SEARCH_BINDING && this.sentMessageSearchService) {
            void respondToSentMessageSearch(event.params.payload, this.connection, this.sentMessageSearchService)
              .catch((error) => this.logger.warn(`[codex-control-console] sent message search failed: ${error.message}`));
          } else if (event.params?.name === PROJECT_CHECKLIST_SYNC_BINDING && event.params.payload === 'return') {
            this.checklistWake.request();
          }
        });
        this.targetId = target.id;
      }
      await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
      await this.connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
      await this.connection.send("Runtime.addBinding", { name: NATIVE_JEV_ROUTING_BINDING });
      if (this.dashboardLauncher) await this.connection.send("Runtime.addBinding", { name: NATIVE_DASHBOARD_BINDING });
      await this.connection.send("Runtime.addBinding", { name: SENT_MESSAGE_SEARCH_BINDING });
      await this.connection.send("Runtime.addBinding", { name: PROJECT_CHECKLIST_SYNC_BINDING });
      if (this.terminalConversations && !this.reloadAfterCspBypass) await prepareNativeTerminalRuntime(this.connection);
      const sidebarLabels = await this.sidebarLabelProvider?.read?.() || [];
      const remoteSidebar = await this.remoteSidebarProvider?.read?.() || [];
      await installIntoTarget(this.connection, this.dashboardUrl, {
        contextOverrides: this.contextWindowStore?.list?.() || [],
        contextWindowStore: this.contextWindowStore,
        turboPolicy: this.turboPolicyProvider?.snapshot?.() || null,
        jevRouting: await this.jevRoutingService?.snapshot?.() || null,
        sidebarLabels,
        remoteSidebar,
        projectSearch: await this.newProjectProvider?.readSearch?.(),
        newProjects: await this.newProjectProvider?.read?.() || [],
        attentionConversations: await this.attentionConversationProvider?.read?.(),
        recentSentConversations: await this.recentSentConversationProvider?.read?.(),
        turnStateSnapshot: await this.turnStateProvider?.snapshot?.(),
        reloadAfterCspBypass: this.reloadAfterCspBypass,
        standaloneDashboardBinding: this.dashboardLauncher && !this.reloadAfterCspBypass ? NATIVE_DASHBOARD_BINDING : "",
        hostActionBinding: this.dashboardLauncher ? NATIVE_DASHBOARD_BINDING : ""
      });
      await syncTurnAnnotations(this.connection, this.annotationStore, { targets, dashboardUrl: this.dashboardUrl });
      this.checklistWake.clear(); // The imminent periodic read includes earlier return signals.
      await syncProjectChecklist(this.connection, this.checklistStore);
    } catch (error) {
      if (/CDP (command timed out|websocket closed|connection closed)/.test(error.message || '')) {
        this.removeTerminalBinding?.(); this.removeContextBindingListener?.(); this.removeContextBindingListener = null;
        const stale = this.connection; this.connection = null; this.targetId = null;
        await stale?.close().catch(() => {});
      }
      this.logger.warn(`[codex-control-console] injector waiting: ${error.message}`);
    } finally {
      this.syncing = false;
      this.checklistWake.resume();
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.sync();
    this.timer = setInterval(() => void this.sync(), this.pollMs);
  }

  async stop() {
    this.running = false;
    this.checklistWake.clear();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.removeTerminalBinding?.(); this.removeContextBindingListener?.();
    this.removeContextBindingListener = null;
    await this.contextActionChain;
    await this.turboActionChain;
    await this.jevActionChain;
    await this.dashboardLaunchChain;
    await this.checklistWake.settle();
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
