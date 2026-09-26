export const DEFAULT_TURBO_QUOTA_THRESHOLD = 10;

export function isTurboQuotaThreshold(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

export function normalizeTurboQuotaSettings(value = {}) {
  return {
    autoDisableOnLowQuota: value.autoDisableOnLowQuota !== false,
    quotaRemainingThreshold: isTurboQuotaThreshold(value.quotaRemainingThreshold) ? value.quotaRemainingThreshold : DEFAULT_TURBO_QUOTA_THRESHOLD
  };
}

export function evaluateTurboQuota(policy, usage, now = Date.now()) {
  const { autoDisableOnLowQuota, quotaRemainingThreshold } = normalizeTurboQuotaSettings(policy);
  if (!autoDisableOnLowQuota) return { state: 'disabled', thresholdPercent: quotaRemainingThreshold };
  if (!policy.enabled || policy.active === false) return { state: 'inactive', thresholdPercent: quotaRemainingThreshold };
  const windows = (Array.isArray(usage?.windows) ? usage.windows : []).filter(window =>
    window?.limitId === 'codex' && typeof window.usedPercent === 'number' && Number.isFinite(window.usedPercent) &&
    window.usedPercent >= 0 && window.usedPercent <= 100 &&
    (window.resetsAt == null || (typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) && window.resetsAt * 1000 > now))
  );
  if (!windows.length) return { state: 'unknown', thresholdPercent: quotaRemainingThreshold };
  const lowest = windows.reduce((selected, window) => window.usedPercent > selected.usedPercent ? window : selected);
  const remainingPercent = Math.max(0, Math.min(100, 100 - lowest.usedPercent));
  return { state: remainingPercent <= quotaRemainingThreshold ? 'low' : 'healthy', remainingPercent,
    thresholdPercent: quotaRemainingThreshold, windowKind: lowest.kind,
    windowDurationMins: lowest.windowDurationMins ?? null, resetsAt: lowest.resetsAt ?? null };
}
