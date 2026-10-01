import { deriveRouterStatus, shouldAutoRepair } from "./router-supervision-policy.mjs";

const HISTORY_LIMIT = 20;

export class RouterSupervisor {
  constructor({ adapter, autoRepair = true, intervalMs = 15_000, now = () => Date.now(), log = (line) => console.log(line) }) {
    Object.assign(this, { adapter, autoRepair, intervalMs, now, log });
    this.snapshot = null;
    this.stoppedStreak = 0;
    this.history = [];
    this.timer = null;
    this.pending = null;
    this.repairing = null;
  }

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Coalesces concurrent probes; HTTP reads and the timer share one in-flight check.
  check() {
    if (!this.pending) this.pending = this.#probe().finally(() => { this.pending = null; });
    return this.pending;
  }

  async read() {
    return this.snapshot && this.now() - Date.parse(this.snapshot.checkedAt) < this.intervalMs ? this.snapshot : this.check();
  }

  diagnostics() {
    const current = this.snapshot;
    if (!current) return { status: "unknown", reason: "Router 状态尚未检查" };
    const status = current.status === "ready" ? "ready" : ["degraded", "unknown"].includes(current.status) ? "degraded" : "unavailable";
    return { status, reason: current.reason, details: { router: current.status, version: current.health?.version ?? null, state: current.service?.state ?? null } };
  }

  async tick() {
    try {
      const current = await this.check();
      if (this.autoRepair && shouldAutoRepair({ status: current.status, stoppedStreak: this.stoppedStreak, history: this.history, now: this.now() })) {
        await this.#repair("bootstrap", "auto");
      }
    } catch (error) {
      this.log(`[codex-control-console] router supervision failed: ${error.message}`);
    }
  }

  async repair() {
    const current = await this.check();
    if (!current.repair) throw Object.assign(new Error(current.reason || "Router 当前无需修复"), { statusCode: 409 });
    return this.#repair(current.repair, "manual");
  }

  async #repair(action, trigger) {
    if (this.repairing) return this.repairing;
    this.repairing = (async () => {
      const entry = { at: this.now(), action, trigger, ok: true, message: null };
      try { await (action === "kickstart" ? this.adapter.kickstart() : this.adapter.bootstrap()); }
      catch (error) { entry.ok = false; entry.message = String(error.stderr || error.message || "launchctl 失败").trim().slice(0, 300); }
      this.history = [...this.history, entry].slice(-HISTORY_LIMIT);
      this.log(`[codex-control-console] router ${trigger} ${action}: ${entry.ok ? "ok" : entry.message}`);
      if (entry.ok) this.stoppedStreak = 0;
      return this.check();
    })().finally(() => { this.repairing = null; });
    return this.repairing;
  }

  async #probe() {
    const service = await this.adapter.inspectService();
    const health = service.supported && service.loaded ? await this.adapter.probeHealth() : null;
    const derived = deriveRouterStatus({ service, health });
    this.stoppedStreak = derived.status === "stopped" ? this.stoppedStreak + 1 : 0;
    const last = this.history.at(-1);
    this.snapshot = Object.freeze({
      ...derived,
      service: { label: service.label, installed: service.installed ?? null, enabled: service.enabled ?? null, loaded: service.loaded ?? null, state: service.state ?? null, pid: service.pid ?? null },
      health,
      autoRepair: this.autoRepair,
      checkedAt: new Date(this.now()).toISOString(),
      lastRepair: last ? { ...last, at: new Date(last.at).toISOString() } : null
    });
    return this.snapshot;
  }
}
