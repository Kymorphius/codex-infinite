import { AppServerClient } from './app-server-client.mjs';

function normalizedWindow(kind, value) {
  if (!value || typeof value !== 'object') return null;
  const rawUsedPercent = value.usedPercent ?? value.used_percent;
  if (rawUsedPercent == null) return null;
  const usedPercent = Number(rawUsedPercent);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null;
  const duration = Number(value.windowDurationMins ?? value.window_duration_mins);
  const reset = Number(value.resetsAt ?? value.resets_at);
  return {
    kind,
    usedPercent,
    windowDurationMins: Number.isFinite(duration) && duration > 0 ? duration : null,
    resetsAt: Number.isFinite(reset) && reset > 0 ? reset : null
  };
}

export function normalizeAccountUsage(result) {
  const byId = result?.rateLimitsByLimitId ?? result?.rate_limits_by_limit_id;
  const limits = byId && typeof byId === 'object' && !Array.isArray(byId)
    ? Object.entries(byId)
    : result?.rateLimits || result?.rate_limits ? [["codex", result.rateLimits ?? result.rate_limits]] : [];
  const windows = [];
  for (const [limitId, value] of limits) {
    if (!value || typeof value !== 'object') continue;
    for (const kind of ['primary', 'secondary']) {
      const window = normalizedWindow(kind, value[kind]);
      if (window) windows.push({ limitId, label: typeof value.limitName === 'string' && value.limitName.trim() ? value.limitName.trim() : limitId, ...window });
    }
  }
  return { windows };
}

export class AccountUsageReader {
  constructor({ codexPath, codexHome, clientFactory = () => new AppServerClient({ codexPath, codexHome }) }) {
    this.clientFactory = clientFactory;
  }

  async read() {
    const client = this.clientFactory();
    try {
      await client.initialize();
      return normalizeAccountUsage(await client.request('account/rateLimits/read', {}));
    } finally {
      client.close();
    }
  }
}
