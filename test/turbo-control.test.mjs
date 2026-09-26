import test from "node:test";
import assert from "node:assert/strict";
import { TURBO_POLICY_FIELDS, TurboCoordinator, validateTurboChange } from "../src/turbo-control.mjs";

const basePolicy = {
  enabled: true, model: "gpt-5.6-luna", reasoningEffort: "high", fast: false,
  millionContext: true, autoDisableGlobalRouting: true, autoDisableOnLowQuota: true, quotaRemainingThreshold: 10, accessMode: "workspace", deviceIds: ["local"]
};

function localService(initial = {}) {
  let policy = { ...basePolicy, ...initial };
  return { snapshot: () => policy, async update(change) { policy = { ...policy, ...change }; return policy; } };
}

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
  assert.equal(peerChanges.length, 2);
  assert.deepEqual(Object.keys(peerChanges[0]), TURBO_POLICY_FIELDS);
  assert.deepEqual(Object.keys(peerChanges[1]), TURBO_POLICY_FIELDS);
  assert.equal(peerChanges[0].autoDisableGlobalRouting, true);
  assert.equal(peerChanges[1].enabled, true);
  assert.equal(peerChanges[1].autoDisableGlobalRouting, true);
  await coordinator.update({ enabled: false });
  assert.deepEqual(routingChanges, [false]);
});

test("save persists only the local policy and applies the local routing interlock", async () => {
  const service = localService({ enabled: false, autoDisableGlobalRouting: false });
  const routingChanges = [];
  const coordinator = new TurboCoordinator({
    localService: service, localNode: { id: "local", name: "Local" },
    routingService: { async setEnabled(value) { routingChanges.push(value); } },
    peerAdapters: [{ peer: { id: "remote", name: "Remote" }, updateTurbo() { assert.fail("save must not contact a peer"); } }]
  });
  const result = await coordinator.save({ enabled: true, autoDisableGlobalRouting: true });
  assert.equal(result.operation, "save");
  assert.equal(result.converged, true);
  assert.equal(service.snapshot().enabled, true);
  assert.deepEqual(routingChanges, [false]);
  assert.deepEqual(result.nodes.map(({ id, status }) => ({ id, status })), [{ id: "local", status: "applied" }]);
});

test("sync sends the full saved policy to every peer regardless of application scope", async () => {
  const events = [], changes = [];
  const service = localService();
  const peers = ["laptop", "windows"].map((id) => {
    let policy = { ...basePolicy, enabled: false, reasoningEffort: "low", millionContext: false, accessMode: "preserve", deviceIds: [id] };
    return { peer: { id, name: id }, async updateTurbo(change) { events.push(id); changes.push(change); policy = { ...policy, ...change }; return policy; } };
  });
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: peers,
    routingService: { async setEnabled() { events.push("routing-disabled"); } } });
  const result = await coordinator.sync({ fast: true });
  const expected = { ...basePolicy, fast: true };
  assert.equal(result.operation, "sync");
  assert.equal(result.converged, true);
  assert.deepEqual(events, ["routing-disabled", "laptop", "windows"]);
  assert.deepEqual(changes, [expected, expected]);
  assert.equal(result.nodes.length, 3);
  for (const node of result.nodes) assert.deepEqual(node.policy, expected);
  assert.deepEqual(result.deviceIds, ["local"]);
});

test("global toggle repairs pre-existing peer differences using the complete policy", async () => {
  let received;
  const coordinator = new TurboCoordinator({ localService: localService({ enabled: false }),
    peerAdapters: [{ peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { received = change; return change; } }] });
  const result = await coordinator.setEnabled(true);
  assert.equal(result.operation, "sync");
  assert.deepEqual(received, basePolicy);
});

test("sync reports per-device mismatches and safe failures without undoing local persistence", async () => {
  const service = localService();
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: [
    { peer: { id: "mismatch", name: "Mismatch" }, async updateTurbo(change) { return { ...change, autoDisableGlobalRouting: false }; } },
    { peer: { id: "offline", name: "Offline" }, async updateTurbo() { throw Object.assign(new Error("secret transport credentials"), { code: "TURBO_PEER_UNREACHABLE" }); } },
    { peer: { id: "working", name: "Working" }, async updateTurbo(change) { return change; } }
  ] });
  const result = await coordinator.sync({ fast: true });
  assert.equal(result.converged, false);
  assert.deepEqual(result.nodes.map((node) => node.status), ["applied", "mismatch", "error", "applied"]);
  assert.deepEqual(result.nodes[1].mismatchedFields, ["autoDisableGlobalRouting"]);
  assert.match(result.nodes[2].message, /不可达/);
  assert.doesNotMatch(JSON.stringify(result), /secret transport credentials/);
  assert.equal(service.snapshot().fast, true);
  assert.deepEqual(coordinator.read().nodes, result.nodes);
});

test("sync does not contact peers if local persistence or routing interlock fails", async () => {
  const peers = [{ peer: { id: "peer", name: "Peer" }, updateTurbo() { assert.fail("peer must wait for local success"); } }];
  const failedSave = new TurboCoordinator({
    localService: { async update() { throw new Error("disk full"); } }, peerAdapters: peers
  });
  await assert.rejects(failedSave.sync({ enabled: true }), /disk full/);
  const service = localService();
  const failedInterlock = new TurboCoordinator({ localService: service, peerAdapters: peers,
    routingService: { async setEnabled() { throw new Error("routing unavailable"); } } });
  await assert.rejects(failedInterlock.sync({ fast: true }), /routing unavailable/);
  assert.equal(service.snapshot().fast, true);
});

test("coordinator serializes saves and full synchronization across callers", async () => {
  const service = localService();
  let releasePeer, signalPeer;
  const enteredPeer = new Promise((resolve) => { signalPeer = resolve; });
  const heldPeer = new Promise((resolve) => { releasePeer = resolve; });
  const changes = [];
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) {
      changes.push(change); signalPeer(); await heldPeer; return change;
    } }
  ] });
  const first = coordinator.sync({ fast: true });
  await enteredPeer;
  const second = coordinator.save({ fast: false });
  const third = coordinator.sync({ millionContext: false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.snapshot().fast, true);
  assert.equal(changes.length, 1);
  releasePeer();
  const results = await Promise.all([first, second, third]);
  assert.deepEqual(results.map((result) => result.operation), ["sync", "save", "sync"]);
  assert.equal(results[0].fast, true);
  assert.equal(results[1].fast, false);
  assert.deepEqual(changes[1], { ...basePolicy, fast: false, millionContext: false });
  assert.deepEqual(coordinator.read().nodes, results[2].nodes);
});

test("a failed local operation does not poison later queued operations", async () => {
  const service = localService();
  const originalUpdate = service.update;
  let fail = true;
  service.update = async (change) => { if (fail) { fail = false; throw new Error("temporary failure"); } return originalUpdate(change); };
  const coordinator = new TurboCoordinator({ localService: service });
  const first = coordinator.save({ fast: true });
  const second = coordinator.save({ fast: false });
  await assert.rejects(first, /temporary failure/);
  assert.equal((await second).fast, false);
});

test("incoming owner policy is local only and outgoing changes queue after it", async () => {
  const service = localService();
  const originalUpdate = service.update;
  let releaseSave;
  const hold = new Promise((resolve) => { releaseSave = resolve; });
  service.update = async (change) => { await hold; return originalUpdate(change); };
  const sent = [];
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { sent.push(change); return change; } }
  ] });
  const incoming = coordinator.receive({ fast: true });
  const outgoing = coordinator.sync({ millionContext: false });
  assert.equal(coordinator.pendingOperations, 2);
  assert.equal(sent.length, 0);
  releaseSave();
  const [received, synced] = await Promise.all([incoming, outgoing]);
  assert.equal(received.operation, "save");
  assert.equal(received.nodes.length, 1);
  assert.deepEqual(sent, [{ ...basePolicy, fast: true, millionContext: false }]);
  assert.equal(synced.converged, true);
  assert.equal(coordinator.pendingOperations, 0);
});

test("incoming owner changes cannot mutate a queued or in-flight synchronization", async () => {
  const service = localService();
  let releasePeer, signalPeer;
  const entered = new Promise((resolve) => { signalPeer = resolve; });
  const held = new Promise((resolve) => { releasePeer = resolve; });
  const coordinator = new TurboCoordinator({ localService: service, peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { signalPeer(); await held; return change; } }
  ] });
  const synchronization = coordinator.sync({ fast: true });
  await assert.rejects(coordinator.receive({ millionContext: false }), { statusCode: 409, code: "TURBO_PEER_BUSY" });
  await entered;
  await assert.rejects(coordinator.receive({ fast: false }), { statusCode: 409, code: "TURBO_PEER_BUSY" });
  assert.equal(service.snapshot().fast, true);
  assert.equal(service.snapshot().millionContext, true);
  releasePeer();
  const result = await synchronization;
  assert.equal(result.converged, true);
  assert.deepEqual(result.nodes[0].policy, service.snapshot());
  await coordinator.receive({ fast: false });
  assert.equal(service.snapshot().fast, false);
});

test("simultaneous synchronization on two devices reports busy instead of deadlocking", async () => {
  const first = new TurboCoordinator({ localService: localService() });
  const second = new TurboCoordinator({ localService: localService() });
  first.peerAdapters = [{ peer: { id: "second", name: "Second" }, updateTurbo: (change) => second.receive(change) }];
  second.peerAdapters = [{ peer: { id: "first", name: "First" }, updateTurbo: (change) => first.receive(change) }];
  const results = await Promise.all([first.sync({ fast: true }), second.sync({ millionContext: false })]);
  for (const result of results) {
    assert.equal(result.converged, false);
    assert.equal(result.nodes[1].status, "error");
    assert.match(result.nodes[1].message, /正在保存或同步/);
  }
  assert.equal(first.read().millionContext, true);
  assert.equal(second.read().fast, false);
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

test("quota settings validate the inclusive percentage range without coercion", () => {
  for (const quotaRemainingThreshold of [0, 10, 100]) {
    const change = { autoDisableOnLowQuota: false, quotaRemainingThreshold };
    assert.deepEqual(validateTurboChange(change), change);
  }
  for (const autoDisableOnLowQuota of [0, 1, "true", null]) {
    assert.throws(() => validateTurboChange({ autoDisableOnLowQuota }), /布尔值/);
  }
  for (const quotaRemainingThreshold of [-1, 101, 10.1, "10", null, NaN, Infinity]) {
    assert.throws(() => validateTurboChange({ quotaRemainingThreshold }), /0 到 100/);
  }
});

test("sync detects quota-trigger policy differences in peer acknowledgements", async () => {
  const coordinator = new TurboCoordinator({ localService: localService(), peerAdapters: [
    { peer: { id: "peer", name: "Peer" }, async updateTurbo(change) { return { ...change, autoDisableOnLowQuota: false, quotaRemainingThreshold: 20 }; } }
  ] });
  const result = await coordinator.sync({ quotaRemainingThreshold: 15 });
  assert.equal(result.converged, false);
  assert.equal(result.quotaRemainingThreshold, 15);
  assert.deepEqual(result.nodes[1].mismatchedFields, ["autoDisableOnLowQuota", "quotaRemainingThreshold"]);
});
