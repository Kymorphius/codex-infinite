import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { buildInjectionScript } from "./injection.mjs";
import {
  buildNativeContextInjectionScript,
  buildNativeContextSnapshotScript,
  NATIVE_CONTEXT_BINDING,
  normalizeNativeContextAction
} from "./native-context-injection.mjs";

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

async function syncNativeContext(connection, contextWindowStore, contextOverrides) {
  await connection.evaluate(buildNativeContextInjectionScript());
  await drainNativeContextActions(connection, contextWindowStore);
  await connection.evaluate(buildNativeContextSnapshotScript(contextWindowStore?.list?.() || contextOverrides));
}

async function waitForReloadedDocument(connection) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const ready = await connection.evaluate("document.readyState === 'interactive' || document.readyState === 'complete'").catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Codex renderer did not become ready after enabling dashboard compatibility");
}

async function prepareCspBypass(connection) {
  if (connection.__codexControlConsoleCspPrepared) return false;
  const alreadyReloaded = await connection.evaluate("Boolean(window.__codexControlConsoleCspBypassReloaded)").catch(() => false);
  await connection.send("Page.setBypassCSP", { enabled: true });
  await connection.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__codexControlConsoleCspBypassReloaded = true;"
  });
  connection.__codexControlConsoleCspPrepared = true;
  if (alreadyReloaded) return false;
  await connection.send("Page.reload", { ignoreCache: false });
  await waitForReloadedDocument(connection);
  return true;
}

export async function installIntoTarget(connection, dashboardUrl, { force = false, contextOverrides = [], contextWindowStore = null } = {}) {
  await connection.send("Page.enable");
  if (!connection.__codexControlConsoleScriptsPrepared) {
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildInjectionScript(dashboardUrl)
    });
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildNativeContextInjectionScript()
    });
    connection.__codexControlConsoleScriptsPrepared = true;
  }
  await prepareCspBypass(connection);
  if (!force && connection.__codexControlConsoleInstalled) {
    const state = await connection.evaluate(`(() => {
      const entry = document.querySelector('[data-codex-control-console-entry]');
      const frame = document.querySelector('[data-codex-control-console-frame]');
      return { hasEntry: Boolean(entry), hasFrame: Boolean(frame), frameReady: Boolean(frame?.hasAttribute('data-codex-control-console-frame-ready')) };
    })()`).catch(() => ({ hasEntry: false, hasFrame: false, frameReady: false }));
    if (state.hasEntry && (!state.hasFrame || state.frameReady || connection.__codexControlConsoleRecoveryAttempted)) {
      await syncNativeContext(connection, contextWindowStore, contextOverrides);
      await connection.evaluate(buildInjectionScript(dashboardUrl));
      return { status: "already-installed" };
    }
    if (state.hasEntry && state.hasFrame && !state.frameReady) {
      await connection.evaluate("window.__codexControlConsoleClose?.()");
      connection.__codexControlConsoleRecoveryAttempted = true;
    }
  }
  await syncNativeContext(connection, contextWindowStore, contextOverrides);
  await connection.evaluate(buildInjectionScript(dashboardUrl));
  connection.__codexControlConsoleInstalled = true;
  return { status: "installed" };
}

export class CodexInjector {
  constructor({ cdpOrigin, dashboardUrl, contextWindowStore = null, pollMs = 1200, logger = console }) {
    this.cdpOrigin = cdpOrigin;
    this.dashboardUrl = dashboardUrl;
    this.pollMs = pollMs;
    this.logger = logger;
    this.contextWindowStore = contextWindowStore;
    this.running = false;
    this.timer = null;
    this.syncing = false;
    this.targetId = null;
    this.connection = null;
    this.removeContextBindingListener = null;
    this.contextActionChain = Promise.resolve();
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const targets = await discoverTargets(this.cdpOrigin);
      const target = chooseMainTarget(targets);
      if (target.id !== this.targetId) {
        this.removeContextBindingListener?.();
        await this.connection?.close();
        this.connection = new CdpConnection(target.webSocketDebuggerUrl);
        await this.connection.connect();
        await this.connection.send("Runtime.addBinding", { name: NATIVE_CONTEXT_BINDING });
        this.removeContextBindingListener = this.connection.onEvent((event) => {
          if (event.method !== "Runtime.bindingCalled" || event.params?.name !== NATIVE_CONTEXT_BINDING) return;
          this.contextActionChain = this.contextActionChain
            .then(() => persistNativeContextAction(event.params.payload, this.contextWindowStore))
            .catch((error) => this.logger.warn(`[codex-control-console] context toggle persistence failed: ${error.message}`));
        });
        this.targetId = target.id;
      }
      await installIntoTarget(this.connection, this.dashboardUrl, {
        contextOverrides: this.contextWindowStore?.list?.() || [],
        contextWindowStore: this.contextWindowStore
      });
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
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
