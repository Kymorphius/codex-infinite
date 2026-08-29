import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { buildInjectionScript } from "./injection.mjs";

export function projectOrderFromTaskResponse(response) {
  const seen = new Set();
  const order = [];
  for (const project of response?.projects || []) {
    const name = String(project?.project || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    order.push(name);
  }
  return order;
}

export async function installIntoTarget(connection, dashboardUrl, { force = false } = {}) {
  if (!force && connection.__codexControlConsoleInstalled) {
    const state = await connection.evaluate(`(() => {
      const entry = document.querySelector('[data-codex-control-console-entry]');
      const frame = document.querySelector('[data-codex-control-console-frame]');
      return { hasEntry: Boolean(entry), hasFrame: Boolean(frame), frameReady: Boolean(frame?.hasAttribute('data-codex-control-console-frame-ready')) };
    })()`).catch(() => ({ hasEntry: false, hasFrame: false, frameReady: false }));
    if (state.hasEntry && (!state.hasFrame || state.frameReady || connection.__codexControlConsoleRecoveryAttempted)) {
      return { status: "already-installed" };
    }
    if (state.hasEntry && state.hasFrame && !state.frameReady) {
      await connection.evaluate("window.__codexControlConsoleClose?.()");
      connection.__codexControlConsoleRecoveryAttempted = true;
    }
  }
  await connection.send("Page.enable");
  if (!connection.__codexControlConsoleInstalled) {
    await connection.send("Page.addScriptToEvaluateOnNewDocument", {
      source: buildInjectionScript(dashboardUrl)
    });
  }
  await connection.evaluate(buildInjectionScript(dashboardUrl));
  connection.__codexControlConsoleInstalled = true;
  return { status: "installed" };
}

export class CodexInjector {
  constructor({ cdpOrigin, dashboardUrl, pollMs = 1200, projectRefreshMs = 15000, fetchImpl = globalThis.fetch, logger = console }) {
    this.cdpOrigin = cdpOrigin;
    this.dashboardUrl = dashboardUrl;
    this.pollMs = pollMs;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.projectRefreshMs = projectRefreshMs;
    this.projectOrder = [];
    this.projectOrderUpdatedAt = 0;
    this.running = false;
    this.timer = null;
    this.syncing = false;
    this.targetId = null;
    this.connection = null;
  }

  async sync() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const targets = await discoverTargets(this.cdpOrigin);
      const target = chooseMainTarget(targets);
      if (target.id !== this.targetId) {
        await this.connection?.close();
        this.connection = new CdpConnection(target.webSocketDebuggerUrl);
        await this.connection.connect();
        this.targetId = target.id;
      }
      await installIntoTarget(this.connection, this.dashboardUrl);
      if (Date.now() - this.projectOrderUpdatedAt >= this.projectRefreshMs) {
        const response = await this.fetchImpl(`${this.dashboardUrl}/api/tasks`, { cache: "no-store" });
        if (response.ok) this.projectOrder = projectOrderFromTaskResponse(await response.json());
        this.projectOrderUpdatedAt = Date.now();
      }
      if (this.projectOrder.length > 0) {
        await this.connection.evaluate(`window.__codexControlConsoleSetProjectOrder?.(${JSON.stringify(this.projectOrder)})`);
      }
      if (!this.connection.__codexControlConsoleCspPrepared) {
        await this.connection.send("Page.setBypassCSP", { enabled: true });
        await this.connection.send("Page.reload", { ignoreCache: false });
        this.connection.__codexControlConsoleCspPrepared = true;
      }
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
    await this.connection?.close();
    this.connection = null;
    this.targetId = null;
  }
}
