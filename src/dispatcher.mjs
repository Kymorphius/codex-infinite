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
      const createThread = item.actionType === "new_thread";
      const contextOverride = createThread ? null : this.contextWindowStore?.get(item.targetThreadId);
      const args = createThread ? ["exec", "--skip-git-repo-check", "--json", "-"] : ["exec", "resume", "--skip-git-repo-check", "--json"];
      if (!createThread) {
        if (contextOverride) args.push("-c", `model_context_window=${contextOverride.requestedContextWindow}`);
        args.push(item.targetThreadId, "-");
      }
      const child = this.spawnImpl(this.codexPath, args, {
        cwd: item.cwd || undefined,
        env: this.codexHome ? { ...process.env, CODEX_HOME: this.codexHome } : undefined,
        stdio: ["pipe", "pipe", "pipe"]
      });
      let errorOutput = "";
      let outputBuffer = "";
      let createdThreadId = null;
      const inspectOutput = (chunk) => {
        outputBuffer += chunk.toString();
        const lines = outputBuffer.split("\n");
        outputBuffer = lines.pop() || "";
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            if (createThread && event.type === "thread.started" && typeof event.thread_id === "string") createdThreadId = event.thread_id;
          } catch {}
        }
      };
      child.stdout?.on("data", inspectOutput);
      child.stderr?.on("data", (chunk) => {
        errorOutput = (errorOutput + chunk.toString()).slice(-this.maxErrorBytes);
      });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (code === 0) {
          if (outputBuffer) inspectOutput("\n");
          resolve(createdThreadId ? { ok: true, threadId: createdThreadId } : { ok: true });
        }
        else reject(new Error(errorOutput.trim() || `Codex 退出：${signal || code}`));
      });
      child.stdin?.end(item.prompt);
    });
  }
}

export class DispatchScheduler {
  constructor({ store, dispatcher, generatorService = null, pollMs = 2000, logger = console }) {
    this.store = store;
    this.dispatcher = dispatcher;
    this.pollMs = pollMs;
    this.logger = logger;
    this.generatorService = generatorService;
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
      try {
        await this.generatorService?.promoteDue();
      } catch (error) {
        this.lastFailureAt = new Date().toISOString();
        this.logger.warn(`[codex-control-console] generator materialization failed: ${error.message}`);
        return;
      }
      await this.store.promoteDue();
      const item = await this.store.claimNext();
      if (!item) return;
      try {
        await this.store.audit?.("submitted", item);
        const result = await this.dispatcher.dispatch(item);
        const outcome = { ok: true, ...(result?.threadId ? { threadId: result.threadId } : {}) };
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
