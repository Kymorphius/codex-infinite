import test from "node:test";
import assert from "node:assert/strict";
import { NodeRuntimeService, normalizeNodeRuntime } from "../src/node-runtime.mjs";

test("node runtime normalizes only bounded ownership states", () => {
  assert.deepEqual(normalizeNodeRuntime({ authority: "spoofed", health: "connected", submission: "native-composer" }), {
    authority: "unknown",
    health: "connected",
    submission: "native-composer",
    activity: "unknown",
    featurePolicy: "unknown"
  });
});

test("node runtime advertises native submission only after a healthy desktop probe", async () => {
  let probes = 0;
  const healthy = new NodeRuntimeService({ nativeConversationAdapter: { async probe() { probes += 1; return true; } }, cacheMs: 100, clock: () => 10 });
  assert.deepEqual(await healthy.read(), {
    authority: "owner-native-desktop",
    health: "connected",
    submission: "native-composer",
    activity: "rollout-projection",
    featurePolicy: "owner-native"
  });
  await healthy.read();
  assert.equal(probes, 1);

  const unavailable = new NodeRuntimeService({ nativeConversationAdapter: { async probe() { return false; } } });
  assert.equal((await unavailable.read()).submission, "unavailable");
  assert.equal((await unavailable.read()).authority, "owner-native-desktop");
});
