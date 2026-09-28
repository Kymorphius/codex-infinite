import { buildNativePinnedEmptyInjectionScript } from "./native-pinned-empty.mjs";
import { buildNativeClaudePreviewInjectionScript } from './native-claude-preview.mjs';
import { buildNativeClaudeToolRowsInjectionScript } from './native-claude-tool-rows.mjs';
import { buildNativeProjectSearchInjectionScript, buildNativeProjectSearchSnapshotScript } from "./native-project-search.mjs";
import { buildNativeSentMessageSearchInjectionScript, respondToSentMessageSearch, SENT_MESSAGE_SEARCH_BINDING } from './native-sent-message-search.mjs';
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
import { buildNativeComposerIconControlsSource } from "./native-composer-icon-controls.mjs";
import { buildNativeLongConversationInjectionScript } from "./native-long-conversation.mjs";
import { buildNativeTurnStateInjectionScript, buildNativeTurnStateSnapshotScript } from "./native-turn-state-status.mjs";
import { deferNativeDocumentSource } from "./native-document-bootstrap.mjs";

function nativeOwnerInjectionScripts() {
  return [
    buildNativePinnedEmptyInjectionScript(),
    buildNativeProjectSearchInjectionScript(),
    buildNativeSentMessageSearchInjectionScript(),
    buildNativeContextInjectionScript(),
    buildNativeApprovalInjectionScript(),
    buildNativeJevRoutingInjectionScript(),
    buildNativeClaudePreviewInjectionScript(),
    buildNativeClaudeToolRowsInjectionScript(),
    buildNativeTurboInjectionScript(),
    buildNativeSidebarLabelsInjectionScript(),
    buildNativeSidebarActivityInjectionScript(),
    buildNativeRemoteSidebarInjectionScript(),
    buildNativeAttentionStickyInjectionScript(),
    buildNativeChatgptChatSectionInjectionScript(),
    buildNativeOpenLocalProjectInjectionScript(),
    buildNativeComposerHeldQueueInjectionScript(),
    `(() => { ${buildNativeComposerControlOrderSource()} })()`,
    buildNativeComposerIconControlsSource(),
    buildNativeLongConversationInjectionScript(),
    buildNativeTurnStateInjectionScript(),
    buildNativeNewProjectsInjectionScript(),
    buildNativeAttentionConversationsInjectionScript()
  ];
}

function nativeOwnerDocumentStartScripts() {
  return nativeOwnerInjectionScripts().filter((source) => !source.includes("__codexControlConsoleHeldQueueInstalledVersion"));
}

export function nativeOwnerPollDelay(pollMs, failureCount, maximumMs = 30000) {
  const base = Math.max(100, Number(pollMs) || 1200);
  const failures = Math.max(0, Math.floor(Number(failureCount) || 0));
  return Math.min(Math.max(base, Number(maximumMs) || 30000), base * (2 ** Math.min(failures, 10)));
}

export class NativeOwnerInjector {
  constructor({ cdpOrigin, contextWindowStore = null, turboPolicyProvider = null, turboController = null, jevRoutingService = null, sidebarLabelProvider = null, remoteSidebarProvider = null, newProjectProvider = null, sentMessageSearchService = null, attentionConversationProvider = null, turnStateProvider = null, pollMs = 1200, backoffMaxMs = 30000, logger = console, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.contextWindowStore = contextWindowStore;
    this.turboPolicyProvider = turboPolicyProvider;
    this.turboController = turboController;
    this.jevRoutingService = jevRoutingService;
    this.sidebarLabelProvider = sidebarLabelProvider;
    this.remoteSidebarProvider = remoteSidebarProvider;
    this.newProjectProvider = newProjectProvider;
    this.sentMessageSearchService = sentMessageSearchService;
    this.attentionConversationProvider = attentionConversationProvider;
    this.turnStateProvider = turnStateProvider;
    this.pollMs = pollMs;
    this.backoffMaxMs = backoffMaxMs;
    this.logger = logger;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.running = false;
    this.syncing = false;
    this.timer = null;
    this.failureCount = 0;
    this.lastFailureMessage = "";
    this.targetId = null;
    this.connection = null;
    this.removeBindingListener = null;
    this.contextActionChain = Promise.resolve();
    this.turboActionChain = Promise.resolve();
    this.jevActionChain = Promise.resolve();
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
      await connection.send("Runtime.addBinding", { name: NATIVE_JEV_ROUTING_BINDING });
      await connection.send("Runtime.addBinding", { name: SENT_MESSAGE_SEARCH_BINDING });
      for (const source of nativeOwnerDocumentStartScripts()) {
        await connection.send("Page.addScriptToEvaluateOnNewDocument", { source: deferNativeDocumentSource(source) });
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
          .then(() => respondToNativeTurboBinding(event.params.payload, connection, this.turboController))
          .catch((error) => this.logger.warn(`[codex-control-console] primary Turbo toggle failed: ${error.message}`));
      } else if (event.params?.name === NATIVE_JEV_ROUTING_BINDING) {
        this.jevActionChain = this.jevActionChain
          .then(() => respondToNativeJevRoutingBinding(event.params.payload, connection, this.jevRoutingService))
          .catch((error) => this.logger.warn(`[codex-control-console] primary Jev native routing failed: ${error.message}`));
      } else if (event.params?.name === SENT_MESSAGE_SEARCH_BINDING && this.sentMessageSearchService) {
        void respondToSentMessageSearch(event.params.payload, connection, this.sentMessageSearchService)
          .catch((error) => this.logger.warn(`[codex-control-console] primary sent message search failed: ${error.message}`));
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
      await this.connection.send("Runtime.addBinding", { name: NATIVE_JEV_ROUTING_BINDING });
      await this.connection.send("Runtime.addBinding", { name: SENT_MESSAGE_SEARCH_BINDING });
      for (const source of nativeOwnerInjectionScripts()) await this.connection.evaluate(source);
      await this.connection.evaluate(buildNativeContextSnapshotScript(this.contextWindowStore?.list?.() || []));
      await this.connection.evaluate(buildNativeTurboSnapshotScript(this.turboPolicyProvider?.snapshot?.() || null));
      await this.connection.evaluate(buildNativeJevRoutingSnapshotScript(await this.jevRoutingService?.snapshot?.() || null));
      await this.connection.evaluate(buildNativeSidebarLabelsSnapshotScript(await this.sidebarLabelProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeRemoteSidebarSnapshotScript(await this.remoteSidebarProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeProjectSearchSnapshotScript(await this.newProjectProvider?.readSearch?.()));
      await this.connection.evaluate(buildNativeNewProjectsSnapshotScript(await this.newProjectProvider?.read?.() || []));
      await this.connection.evaluate(buildNativeAttentionConversationsSnapshotScript(await this.attentionConversationProvider?.read?.()));
      await this.connection.evaluate(buildNativeTurnStateSnapshotScript(await this.turnStateProvider?.snapshot?.()));
      this.failureCount = 0;
      this.lastFailureMessage = "";
    } catch (error) {
      this.removeBindingListener?.();
      this.removeBindingListener = null;
      await this.connection?.close().catch(() => {});
      this.connection = null;
      this.targetId = null;
      const message = error.message || String(error), nextFailure = this.failureCount + 1;
      const shouldLog = nextFailure === 1 || message !== this.lastFailureMessage || (nextFailure & (nextFailure - 1)) === 0;
      this.failureCount = nextFailure;
      this.lastFailureMessage = message;
      if (shouldLog) this.logger.warn(`[codex-control-console] primary native bridge waiting: ${message}`);
    } finally {
      this.syncing = false;
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.sync();
    this.scheduleNext();
  }

  scheduleNext() {
    if (!this.running) return;
    const delay = nativeOwnerPollDelay(this.pollMs, this.failureCount, this.backoffMaxMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync().finally(() => this.scheduleNext());
    }, delay);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.removeBindingListener?.();
    this.removeBindingListener = null;
    await this.contextActionChain;
    await this.turboActionChain;
    await this.jevActionChain;
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
