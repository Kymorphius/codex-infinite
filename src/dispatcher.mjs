import { spawn } from "node:child_process";

export class CodexCliDispatcher {
  constructor({ codexPath, codexHome = null, contextWindowStore = null, spawnImpl = spawn, maxErrorBytes = 12000 }) {
    this.codexPath = codexPath;
    this.spawnImpl = spawnImpl;
    this.maxErrorBytes = maxErrorBytes;
    this.contextWindowStore = contextWindowStore;
    this.codexHome = codexHome;
  }

  dispatch(item) {
    return new Promise((resolve, reject) => {
      const contextOverride = this.contextWindowStore?.get(item.targetThreadId);
      const args = ["exec", "resume", "--skip-git-repo-check", "--json"];
      if (contextOverride) args.push("-c", `model_context_window=${contextOverride.requestedContextWindow}`);
      args.push(item.targetThreadId, "-");
      const child = this.spawnImpl(this.codexPath, args, {
        cwd: item.cwd || undefined,
        env: this.codexHome ? { ...process.env, CODEX_HOME: this.codexHome } : undefined,
        stdio: ["pipe", "ignore", "pipe"]
      });
      let errorOutput = "";
      child.stderr?.on("data", (chunk) => {
        errorOutput = (errorOutput + chunk.toString()).slice(-this.maxErrorBytes);
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) resolve({ ok: true });
        else reject(new Error(errorOutput.trim() || `Codex 退出：${signal || code}`));
      });
      child.stdin?.end(item.prompt);
    });
  }
}

export class DispatchScheduler {
  constructor({ store, dispatcher, pollMs = 2000, logger = console }) {
    this.store = store;
    this.dispatcher = dispatcher;
    this.pollMs = pollMs;
    this.logger = logger;
    this.timer = null;
    this.busy = false;
    this.lastTickAt = null;
    this.lastSuccessAt = null;
    this.lastFailureAt = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    this.lastTickAt = new Date().toISOString();
    try {
      await this.store.promoteDue();
      const item = await this.store.claimNext();
      if (!item) return;
      try {
        await this.store.audit?.("submitted", item);
        await this.dispatcher.dispatch(item);
        const outcome = { ok: true };
        if (item.activeAttemptId) outcome.attemptId = item.activeAttemptId;
        await this.store.finish(item.id, outcome);
        this.lastSuccessAt = new Date().toISOString();
      } catch (error) {
        const outcome = { ok: false, error: error.message };
        if (item.activeAttemptId) outcome.attemptId = item.activeAttemptId;
        await this.store.finish(item.id, outcome);
        this.lastFailureAt = new Date().toISOString();
        this.logger.warn(`[codex-control-console] dispatch failed: ${error.message}`);
      }
    } finally {
      this.busy = false;
    }
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  diagnostics() {
    return Object.freeze({
      status: this.timer ? "ready" : "unavailable",
      busy: this.busy,
      lastTickAt: this.lastTickAt,
      lastSuccessAt: this.lastSuccessAt,
      lastFailureAt: this.lastFailureAt
    });
  }
}
