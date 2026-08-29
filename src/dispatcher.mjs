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
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.store.promoteDue();
      const item = await this.store.claimNext();
      if (!item) return;
      try {
        await this.dispatcher.dispatch(item);
        await this.store.finish(item.id, { ok: true });
      } catch (error) {
        await this.store.finish(item.id, { ok: false, error: error.message });
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
}
