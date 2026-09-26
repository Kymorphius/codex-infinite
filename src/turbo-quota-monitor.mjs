import { evaluateTurboQuota } from './turbo-quota-policy.mjs';

export class TurboQuotaMonitor {
  constructor({ reader, coordinator, now = Date.now, intervalMs = 60_000, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
    Object.assign(this, { reader, coordinator, now, intervalMs, setIntervalImpl, clearIntervalImpl });
    this.running = false;
    this.generation = 0;
    this.inFlight = null;
    this.timer = null;
    this.lastStatus = null;
    this.lastRevision = null;
  }

  snapshot() {
    const policy = this.coordinator.localService.snapshot();
    const current = evaluateTurboQuota(policy, null, this.now());
    if (current.state === 'disabled') return current;
    if (!policy.enabled && this.lastStatus?.state === 'triggered' && this.lastRevision === this.coordinator.policyRevision && this.lastStatus.thresholdPercent === current.thresholdPercent) return { ...this.lastStatus };
    if (current.state === 'inactive') return current;
    const fresh = this.lastRevision === this.coordinator.policyRevision && this.now() - Date.parse(this.lastStatus?.lastCheckedAt) <= 120_000;
    if (fresh && this.lastStatus && this.lastStatus.thresholdPercent === current.thresholdPercent && ['healthy', 'unknown'].includes(this.lastStatus.state)) return { ...this.lastStatus };
    return current;
  }

  start() {
    if (this.running) return this.inFlight || Promise.resolve(this.snapshot());
    this.running = true;
    this.generation += 1;
    this.timer = this.setIntervalImpl(() => { void this.check(); }, this.intervalMs);
    this.timer?.unref?.();
    return this.check();
  }

  stop() {
    this.running = false;
    this.generation += 1;
    if (this.timer !== null) this.clearIntervalImpl(this.timer);
    this.timer = null;
  }

  check() {
    if (!this.running) return Promise.resolve(this.snapshot());
    if (this.inFlight) return this.inFlight;
    const generation = this.generation;
    this.inFlight = this.readAndApply(generation).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async readAndApply(generation) {
    const initial = evaluateTurboQuota(this.coordinator.localService.snapshot(), null, this.now());
    if (['disabled', 'inactive'].includes(initial.state)) return this.snapshot();
    const expectedRevision = this.coordinator.policyRevision;
    const isCurrent = () => this.running && generation === this.generation;
    try {
      const usage = await this.reader.read();
      if (!isCurrent()) return this.snapshot();
      const observedAt = this.now();
      const decision = await this.coordinator.disableForQuota(usage, { observedAt, expectedRevision, isCurrent, now: this.now });
      if (!isCurrent()) return this.snapshot();
      this.lastStatus = decision.state === 'superseded' ? { state: 'unknown', thresholdPercent: this.coordinator.localService.snapshot().quotaRemainingThreshold ?? 10 } : decision;
      this.lastStatus = { ...this.lastStatus, lastCheckedAt: new Date(observedAt).toISOString() };
      this.lastRevision = this.coordinator.policyRevision;
    } catch {
      if (isCurrent()) {
        this.lastStatus = { state: 'unknown', thresholdPercent: this.coordinator.localService.snapshot().quotaRemainingThreshold ?? 10, lastCheckedAt: new Date(this.now()).toISOString() };
        this.lastRevision = this.coordinator.policyRevision;
      }
    }
    return this.snapshot();
  }
}
