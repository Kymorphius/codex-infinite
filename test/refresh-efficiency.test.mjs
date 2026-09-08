import test from "node:test";
import assert from "node:assert/strict";
import { FederatedTaskAdapter } from "../src/federated-task-adapter.mjs";
import { normalizePeerDefinition } from "../src/peer-contract.mjs";
import { SshPeerAdapter } from "../src/ssh-peer-adapter.mjs";

test("federated adapter coalesces overlapping aggregate reads", async () => {
  let release;
  let localReads = 0;
  let remoteReads = 0;
  const blocker = new Promise((resolve) => { release = resolve; });
  const localAdapter = { async listTasks() { localReads += 1; await blocker; return { status: "empty", tasks: [], devices: [] }; } };
  const remoteAdapter = { async listTasks() { remoteReads += 1; return { status: "empty", tasks: [], devices: [] }; } };
  const adapter = new FederatedTaskAdapter({ localAdapter, peerAdapters: [remoteAdapter] });
  const first = adapter.listTasks();
  const second = adapter.listTasks();
  assert.equal(localReads, 1);
  assert.equal(remoteReads, 1);
  release();
  await Promise.all([first, second]);
});

test("peer read failures back off and a successful recovery resets the cooldown", async () => {
  let now = 1_000;
  let calls = 0;
  const peer = normalizePeerDefinition({
    id: "offline-peer",
    name: "Offline peer",
    transports: [{ type: "direct-ssh", host: "offline.local", user: "tester", port: 22, dashboardPort: 47831 }]
  });
  const adapter = new SshPeerAdapter({
    peer,
    clock: () => now,
    backoffBaseMs: 5_000,
    logger: { warn() {} },
    async execFileImpl() {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return { stdout: JSON.stringify({ schemaVersion: 1, status: "empty", tasks: [] }) };
    }
  });
  assert.equal((await adapter.listTasks()).status, "error");
  assert.equal((await adapter.listTasks()).status, "error");
  await assert.rejects(() => adapter.getActivity("thread-1"), { statusCode: 503 });
  assert.equal(calls, 1);
  now += 5_000;
  assert.equal((await adapter.listTasks()).status, "empty");
  assert.equal(calls, 2);
  assert.equal(adapter.nextReadAt, 0);
  assert.equal(adapter.readFailures, 0);
});
