import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { buildNativeApprovalInjectionScript } from "./native-approval-injection.mjs";
import {
  buildNativeContextInjectionScript,
  buildNativeContextSnapshotScript,
  NATIVE_CONTEXT_BINDING
} from "./native-context-injection.mjs";
import { persistNativeContextAction } from "./injector.mjs";

export class NativeOwnerInjector {
  constructor({ cdpOrigin, contextWindowStore = null, pollMs = 1200, logger = console, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.contextWindowStore = contextWindowStore;
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
  }

  async attach(target) {
    this.removeBindingListener?.();
    await this.connection?.close();
    const connection = this.connectionFactory(target.webSocketDebuggerUrl);
    try {
      await connection.connect();
      await connection.send("Page.enable");
      await connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
      for (const source of [buildNativeContextInjectionScript(), buildNativeApprovalInjectionScript()]) {
        await connection.send("Page.addScriptToEvaluateOnNewDocument", { source });
        await connection.evaluate(source);
      }
    } catch (error) {
      await connection.close().catch(() => {});
      throw error;
    }
    this.removeBindingListener = connection.onEvent?.((event) => {
      if (event.method !== "Runtime.bindingCalled" || event.params?.name !== NATIVE_CONTEXT_BINDING) return;
      this.contextActionChain = this.contextActionChain
        .then(() => persistNativeContextAction(event.params.payload, this.contextWindowStore))
        .catch((error) => this.logger.warn(`[codex-control-console] primary context persistence failed: ${error.message}`));
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
      await this.connection.evaluate(buildNativeContextSnapshotScript(this.contextWindowStore?.list?.() || []));
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
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
