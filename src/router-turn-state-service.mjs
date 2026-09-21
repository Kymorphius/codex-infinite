import fs from "node:fs/promises";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{32,}$/;

function boundedText(value, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maxLength ? text : null;
}

function normalizedObservation(value) {
  if (!value || typeof value !== "object" || typeof value.present !== "boolean") return null;
  if (!value.present) return Object.freeze({ present: false });
  if (!Number.isSafeInteger(value.length) || value.length <= 0 || value.length > 16_384) return null;
  return Object.freeze({ present: true, length: value.length });
}

function normalizedEntry(value) {
  const threadId = boundedText(value?.threadId, 64)?.toLowerCase();
  const turnId = boundedText(value?.turnId, 64)?.toLowerCase();
  const turnState = normalizedObservation(value?.turnState);
  if (!threadId || !UUID.test(threadId) || !turnState) return null;
  const status = Number.isInteger(value?.status) && value.status >= 0 && value.status <= 599 ? value.status : null;
  const upstreamAttempts = Number.isSafeInteger(value?.upstreamAttempts) && value.upstreamAttempts >= 0 && value.upstreamAttempts <= 32 ? value.upstreamAttempts : null;
  const startedAt = Number.isSafeInteger(value?.startedAt) && value.startedAt > 0 ? value.startedAt : null;
  const endedAt = Number.isSafeInteger(value?.endedAt) && value.endedAt > 0 ? value.endedAt : null;
  return Object.freeze({
    threadId,
    turnId: turnId && UUID.test(turnId) ? turnId : null,
    model: boundedText(value?.model, 120),
    status,
    upstreamAttempts,
    startedAt,
    endedAt,
    turnState
  });
}

export function normalizeRouterTurnStateSnapshot(value, now = Date.now()) {
  const active = Array.isArray(value?.active) ? value.active : [];
  const recent = Array.isArray(value?.recent) ? value.recent : [];
  const entries = [...active, ...recent].slice(-256).map(normalizedEntry).filter(Boolean);
  return Object.freeze({ available: true, observedAt: now, entries: Object.freeze(entries) });
}

export function routerActivityUrl(origin, secret) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || !["", "/"].includes(url.pathname)) {
    throw new Error("Router 观测地址必须是 127.0.0.1 HTTP origin");
  }
  if (!SECRET.test(secret)) throw new Error("Router 调用凭证缺失或无效");
  return `${url.origin}/_codex-router/${secret}/v1/activity`;
}

export class RouterTurnStateService {
  constructor({ origin, callerSecretPath, fetchImpl = fetch, readFile = fs.readFile, timeoutMs = 1500, cacheTtlMs = 1000, now = Date.now } = {}) {
    Object.assign(this, { origin, callerSecretPath, fetchImpl, readFile, timeoutMs, cacheTtlMs, now });
    this.cached = null;
    this.pending = null;
  }

  async refresh() {
    try {
      const secret = String(await this.readFile(this.callerSecretPath, "utf8")).trim();
      const response = await this.fetchImpl(routerActivityUrl(this.origin, secret), {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) throw new Error("Router activity unavailable");
      return normalizeRouterTurnStateSnapshot(await response.json(), this.now());
    } catch {
      return Object.freeze({ available: false, observedAt: this.now(), entries: Object.freeze([]) });
    }
  }

  async snapshot() {
    const now = this.now();
    if (this.cached && now - this.cached.observedAt < this.cacheTtlMs) return this.cached;
    if (!this.pending) this.pending = this.refresh().then((value) => (this.cached = value)).finally(() => { this.pending = null; });
    return this.pending;
  }
}
