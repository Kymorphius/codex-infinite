import { syncProjectChecklist } from './project-checklist-sync.mjs';
import { syncTurnAnnotations } from './turn-annotation-sync.mjs';
import { buildNativeSidebarRestartInjectionScript } from "./native-sidebar-restart.mjs";
import { buildNativePinnedEmptyInjectionScript } from "./native-pinned-empty.mjs";
import { mergeProjectSearchCatalog } from "./federated-project-search.mjs";
import { buildNativeProjectPathMenuScript } from "./native-project-path-menu.mjs";
import { buildNativeProjectSearchInjectionScript, buildNativeProjectSearchSnapshotScript } from "./native-project-search.mjs";
import { buildNativeAttentionConversationsInjectionScript, buildNativeAttentionConversationsSnapshotScript } from "./native-attention-conversations.mjs";
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
import { applyNativeTurboAction, buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript, NATIVE_TURBO_BINDING } from "./native-turbo-injection.mjs";
import { buildNativeSidebarLabelsInjectionScript, buildNativeSidebarLabelsSnapshotScript } from "./native-sidebar-labels.mjs";
import { buildNativeSidebarActivityInjectionScript } from "./native-sidebar-activity.mjs";
import { buildNativeRemoteSidebarInjectionScript, buildNativeRemoteSidebarSnapshotScript } from "./native-remote-sidebar.mjs";
import { buildNativeAttentionStickyInjectionScript } from "./native-attention-sticky.mjs";
import { buildNativeChatgptChatSectionInjectionScript } from "./native-chatgpt-chat-section.mjs";
import { buildNativeOpenLocalProjectInjectionScript } from "./native-open-local-project.mjs";

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

async function syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch) {
  await connection.evaluate(buildNativeApprovalInjectionScript());
  await connection.evaluate(buildNativeContextInjectionScript());
  await drainNativeContextActions(connection, contextWindowStore);
  await connection.evaluate(buildNativeContextSnapshotScript(contextWindowStore?.list?.() || contextOverrides));
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
  await connection.evaluate(buildNativeNewProjectsInjectionScript());
  await connection.evaluate(buildNativeNewProjectsSnapshotScript(newProjects));
  await connection.evaluate(buildNativeAttentionConversationsInjectionScript());
  await connection.evaluate(buildNativeAttentionConversationsSnapshotScript(attentionConversations));
  await connection.evaluate(buildNativePinnedEmptyInjectionScript());
  await connection.evaluate(buildNativeProjectSearchInjectionScript());
  const search = mergeProjectSearchCatalog(projectSearch, remoteSidebar);
  await connection.evaluate(buildNativeProjectSearchSnapshotScript(search));
  await connection.evaluate(buildNativeProjectPathMenuScript([...(projectSearch?.projects || []), ...search.projects]));
}

async function waitForReloadedDocument(connection) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const ready = await connection.evaluate("document.readyState === 'interactive' || document.readyState === 'complete'").catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Codex renderer did not become ready after enabling dashboard compatibility");
}

async function prepareCspBypass(connection, { reloadAfterCspBypass = true } = {}) {
  await connection.send("Page.setBypassCSP", { enabled: true });
  if (connection.__codexControlConsoleCspPrepared) return false;
  const alreadyReloaded = await connection.evaluate("Boolean(window.__codexControlConsoleCspBypassReloaded)").catch(() => false);
  await connection.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__codexControlConsoleCspBypassReloaded = true;"
  });
  connection.__codexControlConsoleCspPrepared = true;
  if (alreadyReloaded || !reloadAfterCspBypass) return false;
  await connection.send("Page.reload", { ignoreCache: false });
  await waitForReloadedDocument(connection);
  return true;
}

export async function installIntoTarget(connection, dashboardUrl, { force = false, contextOverrides = [], contextWindowStore = null, turboPolicy = null, sidebarLabels = [], remoteSidebar = [], newProjects = [], attentionConversations = undefined, projectSearch = undefined, reloadAfterCspBypass = true } = {}) {
  await connection.send("Page.enable");
  if (!connection.__codexControlConsoleScriptsPrepared) {
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildInjectionScript(dashboardUrl)
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeContextInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeApprovalInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeTurboInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeSidebarLabelsInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: buildNativeSidebarActivityInjectionScript() });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeRemoteSidebarInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeAttentionStickyInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeChatgptChatSectionInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeOpenLocalProjectInjectionScript()
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: buildNativeNewProjectsInjectionScript() });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: buildNativeAttentionConversationsInjectionScript() });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: buildNativeProjectSearchInjectionScript() });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: buildNativePinnedEmptyInjectionScript() });
    connection.__codexControlConsoleScriptsPrepared = true;
  }
  await prepareCspBypass(connection, { reloadAfterCspBypass });
  await connection.evaluate(buildNativeSidebarRestartInjectionScript(dashboardUrl));
  if (!force && connection.__codexControlConsoleInstalled) {
    const state = await connection.evaluate(`(() => {
      const entry = document.querySelector('[data-codex-control-console-entry]');
      const frame = document.querySelector('[data-codex-control-console-frame]');
      return { hasEntry: Boolean(entry), hasFrame: Boolean(frame), frameReady: Boolean(frame?.hasAttribute('data-codex-control-console-frame-ready')) };
    })()`).catch(() => ({ hasEntry: false, hasFrame: false, frameReady: false }));
    if (state.hasEntry && (!state.hasFrame || state.frameReady || connection.__codexControlConsoleRecoveryAttempted)) {
      await syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch);
      await connection.evaluate(buildInjectionScript(dashboardUrl));
      return { status: "already-installed" };
    }
    if (state.hasEntry && state.hasFrame && !state.frameReady) {
      await connection.evaluate("window.__codexControlConsoleClose?.()");
      connection.__codexControlConsoleRecoveryAttempted = true;
    }
  }
  await syncNativeContext(connection, contextWindowStore, contextOverrides, turboPolicy, sidebarLabels, remoteSidebar, newProjects, attentionConversations, projectSearch);
  await connection.evaluate(buildInjectionScript(dashboardUrl));
  connection.__codexControlConsoleInstalled = true;
  return { status: "installed" };
}

export class CodexInjector {
  constructor({ cdpOrigin, dashboardUrl, checklistStore = null, annotationStore = null, contextWindowStore = null, turboPolicyProvider = null, turboController = null, sidebarLabelProvider = null, remoteSidebarProvider = null, newProjectProvider = null, attentionConversationProvider = null, recoverTarget = null, reloadAfterCspBypass = true, pollMs = 1200, logger = console }) {
    this.annotationStore = annotationStore;
    this.checklistStore = checklistStore;
    this.cdpOrigin = cdpOrigin;
    this.dashboardUrl = dashboardUrl;
    this.pollMs = pollMs;
    this.logger = logger;
    this.contextWindowStore = contextWindowStore;
    this.turboPolicyProvider = turboPolicyProvider;
    this.turboController = turboController;
    this.sidebarLabelProvider = sidebarLabelProvider;
    this.remoteSidebarProvider = remoteSidebarProvider;
    this.newProjectProvider = newProjectProvider;
    this.attentionConversationProvider = attentionConversationProvider;
    this.recoverTarget = recoverTarget;
    this.reloadAfterCspBypass = reloadAfterCspBypass;
    this.running = false;
    this.timer = null;
    this.syncing = false;
    this.targetId = null;
    this.connection = null;
    this.removeContextBindingListener = null;
    this.contextActionChain = Promise.resolve();
    this.turboActionChain = Promise.resolve();
  }

  async sync() {
    if (this.syncing) return;
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
        this.removeContextBindingListener?.();
        await this.connection?.close();
        this.connection = new CdpConnection(target.webSocketDebuggerUrl);
        await this.connection.connect();
        await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
        await this.connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
        this.removeContextBindingListener = this.connection.onEvent((event) => {
          if (event.method !== "Runtime.bindingCalled") return;
          if (event.params?.name === NATIVE_CONTEXT_BINDING) {
            this.contextActionChain = this.contextActionChain
              .then(() => persistNativeContextAction(event.params.payload, this.contextWindowStore))
              .catch((error) => this.logger.warn(`[codex-control-console] context toggle persistence failed: ${error.message}`));
          } else if (event.params?.name === NATIVE_TURBO_BINDING) {
            this.turboActionChain = this.turboActionChain
              .then(() => applyNativeTurboAction(event.params.payload, this.turboController))
              .catch((error) => this.logger.warn(`[codex-control-console] Turbo toggle failed: ${error.message}`));
          }
        });
        this.targetId = target.id;
      }
      await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
      await this.connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
      const sidebarLabels = await this.sidebarLabelProvider?.read?.() || [];
      const remoteSidebar = await this.remoteSidebarProvider?.read?.() || [];
      await installIntoTarget(this.connection, this.dashboardUrl, {
        contextOverrides: this.contextWindowStore?.list?.() || [],
        contextWindowStore: this.contextWindowStore,
        turboPolicy: this.turboPolicyProvider?.snapshot?.() || null,
        sidebarLabels,
        remoteSidebar,
        projectSearch: await this.newProjectProvider?.readSearch?.(),
        newProjects: await this.newProjectProvider?.read?.() || [],
        attentionConversations: await this.attentionConversationProvider?.read?.(),
        reloadAfterCspBypass: this.reloadAfterCspBypass
      });
      await syncTurnAnnotations(this.connection, this.annotationStore);
      await syncProjectChecklist(this.connection, this.checklistStore);
    } catch (error) {
      this.logger.warn(`[codex-control-console] injector waiting: ${error.message}`);
    } finally {
      this.syncing = false;
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.removeContextBindingListener?.();
    this.removeContextBindingListener = null;
    await this.contextActionChain;
    await this.turboActionChain;
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
