// Pure router supervision policy. Facts come from the launchd adapter and the
// health probe; this module only decides status, repair and auto-repair throttle.
export const ROUTER_STATUSES = Object.freeze(["ready", "degraded", "stopped", "disabled", "not-installed", "unknown"]);
export const AUTO_REPAIR_POLICY = Object.freeze({ confirmations: 2, minIntervalMs: 5 * 60_000, windowMs: 60 * 60_000, maxPerWindow: 3 });

export function deriveRouterStatus({ service = null, health = null } = {}) {
  if (!service?.supported) return { status: "unknown", reason: "当前系统不支持 Router 服务检查", repair: null };
  if (!service.installed) return { status: "not-installed", reason: "未找到 Router LaunchAgent", repair: null };
  if (service.enabled === false) return { status: "disabled", reason: "Router 服务已被停用（launchctl disable）", repair: null };
  if (!service.loaded) return { status: "stopped", reason: "Router 服务未加载到 launchd", repair: "bootstrap" };
  if (!health?.reachable) return { status: "degraded", reason: "Router 已加载但健康检查无响应", repair: "kickstart" };
  if (!health.ok) return { status: "degraded", reason: "Router 健康检查未通过", repair: "kickstart" };
  if (health.degraded?.length) return { status: "degraded", reason: `Router 部分能力降级：${health.degraded.join("、")}`, repair: null };
  return { status: "ready", reason: null, repair: null };
}

// history: [{ at: ms, trigger: "auto" }]; stoppedStreak: consecutive "stopped" observations.
export function shouldAutoRepair({ status, stoppedStreak, history = [], now, policy = AUTO_REPAIR_POLICY }) {
  if (status !== "stopped" || stoppedStreak < policy.confirmations) return false;
  const autos = history.filter((entry) => entry.trigger === "auto" && now - entry.at < policy.windowMs);
  if (autos.length >= policy.maxPerWindow) return false;
  return !autos.some((entry) => now - entry.at < policy.minIntervalMs);
}
