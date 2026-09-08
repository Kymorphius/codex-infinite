import { buildNativePinnedEmptyInjectionScript } from "./native-pinned-empty.mjs";
import { buildNativeProjectSearchInjectionScript, buildNativeProjectSearchSnapshotScript } from "./native-project-search.mjs";
import { buildNativeAttentionConversationsInjectionScript, buildNativeAttentionConversationsSnapshotScript } from "./native-attention-conversations.mjs";
import { buildNativeNewProjectsInjectionScript, buildNativeNewProjectsSnapshotScript } from "./native-new-projects.mjs";
import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { buildNativeApprovalInjectionScript } from "./native-approval-injection.mjs";
import {
  buildNativeContextInjectionScript,
  buildNativeContextSnapshotScript,
  NATIVE_CONTEXT_BINDING
} from "./native-context-injection.mjs";
import { persistNativeContextAction } from "./injector.mjs";
import { applyNativeTurboAction, buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript, NATIVE_TURBO_BINDING } from "./native-turbo-injection.mjs";
import { buildNativeSidebarLabelsInjectionScript, buildNativeSidebarLabelsSnapshotScript } from "./native-sidebar-labels.mjs";
import { buildNativeSidebarActivityInjectionScript } from "./native-sidebar-activity.mjs";
import { buildNativeRemoteSidebarInjectionScript, buildNativeRemoteSidebarSnapshotScript } from "./native-remote-sidebar.mjs";
import { buildNativeAttentionStickyInjectionScript } from "./native-attention-sticky.mjs";
import { buildNativeChatgptChatSectionInjectionScript } from "./native-chatgpt-chat-section.mjs";
import { buildNativeOpenLocalProjectInjectionScript } from "./native-open-local-project.mjs";

function nativeOwnerInjectionScripts() {
  return [
    buildNativePinnedEmptyInjectionScript(),
    buildNativeProjectSearchInjectionScript(),
    buildNativeContextInjectionScript(),
    buildNativeApprovalInjectionScript(),
    buildNativeTurboInjectionScript(),
    buildNativeSidebarLabelsInjectionScript(),
    buildNativeSidebarActivityInjectionScript(),
    buildNativeRemoteSidebarInjectionScript(),
    buildNativeAttentionStickyInjectionScript(),
    buildNativeChatgptChatSectionInjectionScript(),
    buildNativeOpenLocalProjectInjectionScript(),
    buildNativeNewProjectsInjectionScript(),
    buildNativeAttentionConversationsInjectionScript()
  ];
}

export class NativeOwnerInjector {
  constructor({ cdpOrigin, contextWindowStore = null, turboPolicyProvider = null, turboController = null, sidebarLabelProvider = null, remoteSidebarProvider = null, newProjectProvider = null, attentionConversationProvider = null, pollMs = 1200, logger = console, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.contextWindowStore = contextWindowStore;
    this.turboPolicyProvider = turboPolicyProvider;
    this.turboController = turboController;
    this.sidebarLabelProvider = sidebarLabelProvider;
    this.remoteSidebarProvider = remoteSidebarProvider;
    this.newProjectProvider = newProjectProvider;
    this.attentionConversationProvider = attentionConversationProvider;
    this.pollMs = pollMs;
    this.logger = logger;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.running = false;
    this.syncing = false;
    this.timer = null;
    this.targetId = null;
    this.connection = null;
    this.removeBindingListener = null;
    this.contextActionChain = Promise.resolve();
    this.turboActionChain = Promise.resolve();
  }

  async attach(target) {
    this.removeBindingListener?.();
    await this.connection?.close();
    const connection = this.connectionFactory(target.webSocketDebuggerUrl);
    try {
      await connection.connect();
      await connection.send("Page.enable");
      await connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
      await connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
      for (const source of nativeOwnerInjectionScripts()) {
        await connection.send("Page.addScriptToEvaluateOnNewDocument", { source });
      }
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
    this.removeBindingListener = connection.onEvent?.((event) => {
      if (event.method !== "Runtime.bindingCalled") return;
      if (event.params?.name === NATIVE_CONTEXT_BINDING) {
        this.contextActionChain = this.contextActionChain
          .then(() => persistNativeContextAction(event.params.payload, this.contextWindowStore))
          .catch((error) => this.logger.warn(`[codex-control-console] primary context persistence failed: ${error.message}`));
      } else if (event.params?.name === NATIVE_TURBO_BINDING) {
        this.turboActionChain = this.turboActionChain
          .then(() => applyNativeTurboAction(event.params.payload, this.turboController))
          .catch((error) => this.logger.warn(`[codex-control-console] primary Turbo toggle failed: ${error.message}`));
      }
    }) || null;
    this.connection = connection;
    this.targetId = target.id;
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const target = this.choose(await this.discover(this.cdpOrigin));
      if (target.id !== this.targetId || !this.connection) await this.attach(target);
      await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
      await this.connection.send("Runtime.addBinding", { name: NATIVE_TURBO_BINDING });
      for (const source of nativeOwnerInjectionScripts()) await this.connection.evaluate(source);
      await this.connection.evaluate(buildNativeContextSnapshotScript(this.contextWindowStore?.list?.() || []));
      await this.connection.evaluate(buildNativeTurboSnapshotScript(this.turboPolicyProvider?.snapshot?.() || null));
      await this.connection.evaluate(buildNativeSidebarLabelsSnapshotScript(await this.sidebarLabelProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeRemoteSidebarSnapshotScript(await this.remoteSidebarProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeProjectSearchSnapshotScript(await this.newProjectProvider?.readSearch?.()));
      await this.connection.evaluate(buildNativeNewProjectsSnapshotScript(await this.newProjectProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeAttentionConversationsSnapshotScript(await this.attentionConversationProvider?.read?.()));
    } catch (error) {
      this.removeBindingListener?.();
      this.removeBindingListener = null;
      await this.connection?.close().catch(() => {});
      this.connection = null;
      this.targetId = null;
      this.logger.warn(`[codex-control-console] primary native bridge waiting: ${error.message}`);
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
    this.removeBindingListener?.();
    this.removeBindingListener = null;
    await this.contextActionChain;
    await this.turboActionChain;
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
