const AUTHORITIES = new Set(["owner-native-desktop", "unknown"]);
const HEALTH = new Set(["connected", "unavailable", "unknown"]);
const SUBMISSIONS = new Set(["native-composer", "unavailable", "unknown"]);
const ACTIVITIES = new Set(["rollout-projection", "unknown"]);
const FEATURE_POLICIES = new Set(["owner-native", "unknown"]);

const UNKNOWN_RUNTIME = Object.freeze({
  authority: "unknown",
  health: "unknown",
  submission: "unknown",
  activity: "unknown",
  featurePolicy: "unknown"
});

function member(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

export function normalizeNodeRuntime(input = {}) {
  return Object.freeze({
    authority: member(input.authority, AUTHORITIES, "unknown"),
    health: member(input.health, HEALTH, "unknown"),
    submission: member(input.submission, SUBMISSIONS, "unknown"),
    activity: member(input.activity, ACTIVITIES, "unknown"),
    featurePolicy: member(input.featurePolicy, FEATURE_POLICIES, "unknown")
  });
}

export function unknownNodeRuntime() {
  return UNKNOWN_RUNTIME;
}

export class NodeRuntimeService {
  constructor({ nativeConversationAdapter, cacheMs = 5_000, clock = () => Date.now() } = {}) {
    this.nativeConversationAdapter = nativeConversationAdapter;
    this.cacheMs = cacheMs;
    this.clock = clock;
    this.cached = null;
  }

  async read() {
    const now = this.clock();
    if (this.cached && now - this.cached.at < this.cacheMs) return this.cached.value;
    let available = false;
    try {
      available = Boolean(await this.nativeConversationAdapter?.probe?.());
    } catch {
      available = false;
    }
    const value = normalizeNodeRuntime({
      authority: "owner-native-desktop",
      health: available ? "connected" : "unavailable",
      submission: available ? "native-composer" : "unavailable",
      activity: "rollout-projection",
      featurePolicy: "owner-native"
    });
    this.cached = { at: now, value };
    return value;
  }
}
