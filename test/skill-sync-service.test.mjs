import test from "node:test";
import assert from "node:assert/strict";
import { SkillSyncService } from "../src/skill-sync-service.mjs";

const hash = "a".repeat(64);
const package_ = { schemaVersion: 1, scope: "codex-user", name: "demo", hash, totalBytes: 1, files: [{ path: "SKILL.md", executable: false, content: "eA==" }] };

test("Skill sync routes a stable source package to every healthy target", async () => {
  const calls = [];
  const localAdapter = {
    async list() { return { schemaVersion: 1, skills: [{ scope: "codex-user", name: "demo", hash }] }; },
    async export() { return package_; },
    async install(input) { calls.push(["local", input.expectedCurrentHash]); return { hash, backupCreated: false }; }
  };
  const peerAdapter = {
    peer: { id: "remote", name: "Remote", location: "peer" },
    async listSkills() { return { status: "connected", device: this.peer, schemaVersion: 1, skills: [] }; },
    async installSkill(_package, expected) { calls.push(["remote", expected]); return { hash, backupCreated: false }; }
  };
  const service = new SkillSyncService({ localAdapter, peerAdapters: [peerAdapter], localNode: { id: "local", name: "Local" } });
  const result = await service.sync({ sourceDeviceId: "local", scope: "codex-user", name: "demo", sourceHash: hash, targetDeviceIds: ["remote"] });
  assert.equal(result.converged, true);
  assert.deepEqual(calls, [["remote", null]]);
});

test("Skill sync refuses a changed source fingerprint", async () => {
  const service = new SkillSyncService({
    localAdapter: { async export() { return { ...package_, hash: "b".repeat(64) }; } },
    peerAdapters: [], localNode: { id: "local" }
  });
  await assert.rejects(service.sync({ sourceDeviceId: "local", scope: "codex-user", name: "demo", sourceHash: hash, targetDeviceIds: ["remote"] }), /来源 Skill 已发生变化/);
});

test("Skill sync reports an unavailable peer without hiding healthy target results", async () => {
  const localAdapter = { async list() { return { skills: [] }; }, async export() { return package_; } };
  const healthy = { peer: { id: "healthy", name: "Healthy" }, async listSkills() { return { status: "connected", device: this.peer, skills: [] }; }, async installSkill() { return { hash, backupCreated: false }; } };
  const offline = { peer: { id: "offline", name: "Offline" }, async listSkills() { return { status: "error", device: this.peer, skills: [], message: "offline" }; } };
  const service = new SkillSyncService({ localAdapter, peerAdapters: [healthy, offline], localNode: { id: "local" } });
  const result = await service.sync({ sourceDeviceId: "local", scope: "codex-user", name: "demo", sourceHash: hash, targetDeviceIds: ["healthy", "offline"] });
  assert.equal(result.converged, false);
  assert.deepEqual(result.results.map((item) => item.status), ["applied", "error"]);
});
