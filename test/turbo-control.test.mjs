import test from "node:test";
import assert from "node:assert/strict";
import { TurboCoordinator, validateTurboChange } from "../src/turbo-control.mjs";

test("Turbo validates the automatic global-routing interlock", () => {
  assert.deepEqual(validateTurboChange({ autoDisableGlobalRouting: true }), { autoDisableGlobalRouting: true });
  assert.throws(() => validateTurboChange({ autoDisableGlobalRouting: "yes" }), /布尔值/);
});

test("enabled Turbo disables global routing when the interlock is selected", async () => {
  let policy = { enabled: false, autoDisableGlobalRouting: false };
  const routingChanges = [], peerChanges = [];
  const coordinator = new TurboCoordinator({
    localService: { snapshot: () => policy, async update(change) { policy = { ...policy, ...change }; return policy; } },
    peerAdapters: [{ peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { peerChanges.push(change); return { ...policy, ...change, transport: "direct" }; } }],
    localNode: { id: "local", name: "Local" },
    routingService: { async setEnabled(value) { routingChanges.push(value); } }
  });
  await coordinator.update({ autoDisableGlobalRouting: true });
  assert.deepEqual(routingChanges, []);
  await coordinator.update({ enabled: true });
  assert.deepEqual(routingChanges, [false]);
  assert.deepEqual(peerChanges, [{ autoDisableGlobalRouting: true }, { enabled: true }]);
  await coordinator.update({ enabled: false });
  assert.deepEqual(routingChanges, [false]);
});

test("selecting the interlock while Turbo is active closes routing immediately", async () => {
  let policy = { enabled: true, autoDisableGlobalRouting: false };
  const routingChanges = [];
  const coordinator = new TurboCoordinator({
    localService: { snapshot: () => policy, async update(change) { policy = { ...policy, ...change }; return policy; } },
    routingService: { async setEnabled(value) { routingChanges.push(value); } }
  });
  await coordinator.update({ autoDisableGlobalRouting: true });
  assert.deepEqual(routingChanges, [false]);
  await coordinator.update({ autoDisableGlobalRouting: false });
  assert.deepEqual(routingChanges, [false]);
});
