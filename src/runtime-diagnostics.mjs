const CHECK_STATUSES = new Set(["ready", "degraded", "unavailable", "unknown"]);

function normalizedCheck(name, input = {}) {
  const status = CHECK_STATUSES.has(input.status) ? input.status : "unknown";
  return Object.freeze({
    name,
    status,
    reason: input.reason ? String(input.reason).slice(0, 500) : null,
    details: input.details && typeof input.details === "object" ? Object.freeze({ ...input.details }) : null
  });
}

export function deriveRuntimeDiagnostics({ runtime, dispatch, audit, scheduler } = {}) {
  const checks = Object.freeze([
    normalizedCheck("dashboard", { status: "ready" }),
    normalizedCheck("native-desktop", {
      status: runtime?.health === "connected" ? "ready" : runtime?.health === "unavailable" ? "unavailable" : "unknown",
      reason: runtime?.health === "connected" ? null : "原生 Codex 桌面当前不可用或尚未确认",
      details: runtime ? { authority: runtime.authority, submission: runtime.submission } : null
    }),
    normalizedCheck("dispatch-store", {
      status: dispatch?.status,
      details: dispatch ? { queued: dispatch.queued, sending: dispatch.sending, deliveryUnknown: dispatch.deliveryUnknown } : null
    }),
    normalizedCheck("dispatch-audit", audit || { status: "unknown", reason: "未配置调度审计存储" }),
    normalizedCheck("dispatch-scheduler", {
      status: scheduler?.status,
      reason: scheduler?.status === "ready" ? null : "调度器尚未运行",
      details: scheduler ? { busy: scheduler.busy, lastTickAt: scheduler.lastTickAt, lastSuccessAt: scheduler.lastSuccessAt, lastFailureAt: scheduler.lastFailureAt } : null
    })
  ]);
  const status = checks.some((check) => check.status === "unavailable") ? "unavailable"
    : checks.some((check) => ["degraded", "unknown"].includes(check.status)) ? "degraded" : "ready";
  return Object.freeze({ status, passive: true, checks });
}

export class RuntimeDiagnosticsService {
  constructor({ nodeRuntimeService = null, dispatchStore = null, auditStore = null, scheduler = null } = {}) {
    this.nodeRuntimeService = nodeRuntimeService;
    this.dispatchStore = dispatchStore;
    this.auditStore = auditStore;
    this.scheduler = scheduler;
  }

  async read() {
    let runtime = null;
    try { runtime = await this.nodeRuntimeService?.read?.(); } catch {}
    return deriveRuntimeDiagnostics({
      runtime,
      dispatch: this.dispatchStore?.diagnostics?.(),
      audit: this.auditStore?.diagnostics?.(),
      scheduler: this.scheduler?.diagnostics?.()
    });
  }
}
