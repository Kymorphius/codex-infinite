import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDashboardServer } from "../src/http-server.mjs";
import { ACTION_HEADERS, signPeerAction } from "../src/peer-action-auth.mjs";
import { normalizeSkillPackage, serializeSkillPackage } from "../src/skill-contract.mjs";
import { SKILL_INSTALL_ACTION_PATH, SKILL_TOGGLE_ACTION_PATH, sshSkillContentArguments, sshSkillsArguments } from "../src/ssh-peer-commands.mjs";

function config(keyPath) {
  return {
    dashboardHost: "127.0.0.1", dashboardPort: 0, dashboardOrigin: "http://127.0.0.1:0",
    cdpHost: "127.0.0.1", cdpOrigin: "http://127.0.0.1:9231", nodeActionKeyPath: keyPath
  };
}

const package_ = serializeSkillPackage(normalizeSkillPackage({
  scope: "codex-user", name: "demo", files: [{ path: "SKILL.md", content: Buffer.from("---\nname: demo\n---\n").toString("base64") }]
}));

test("Skill browser and signed owner APIs keep read and mutation boundaries separate", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skills-http-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = Buffer.alloc(32, 7);
  const keyPath = path.join(directory, "node.key");
  await fs.writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
  const installs = [];
  const toggles = [];
  const localSkillAdapter = {
    async list() { return { schemaVersion: 1, skills: [{ scope: "codex-user", name: "demo", hash: package_.hash }] }; },
    async export() { return package_; },
    async install(input) { installs.push(input); return { accepted: true, hash: package_.hash, backupCreated: false }; },
    async setEnabled(input) { toggles.push(input); return { enabled: input.enabled, restartRequired: true }; }
  };
  const skillSyncService = {
    async catalog() { return { status: "ok", schemaVersion: 1, devices: [] }; },
    async sync(input) { return { converged: true, results: [], ...input }; },
    async toggle(input) { return { accepted: true, restartRequired: true, ...input }; }
  };
  const dashboard = createDashboardServer({ config: config(keyPath), adapter: {}, localSkillAdapter, skillSyncService });
  await dashboard.listen();
  t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;

  assert.equal((await fetch(`${origin}/api/node/skills`)).status, 200);
  assert.equal((await fetch(`${origin}/api/node/skills/content?scope=codex-user&name=demo`)).status, 200);
  const denied = await fetch(`${origin}/api/skills/sync`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:9" }, body: "{}" });
  assert.equal(denied.status, 403);
  const browser = await fetch(`${origin}/api/skills/sync`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:0" }, body: JSON.stringify({ sourceDeviceId: "local" }) });
  assert.equal(browser.status, 200);
  const toggleDenied = await fetch(`${origin}/api/skills/toggle`, { method: "POST", headers: { "content-type": "application/json", origin: "http://127.0.0.1:9" }, body: "{}" });
  assert.equal(toggleDenied.status, 403);

  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const body = Buffer.from(JSON.stringify({ package: package_, expectedCurrentHash: null, requestId: nonce }));
  const signature = signPeerAction(key, { method: "POST", path: SKILL_INSTALL_ACTION_PATH, timestamp, nonce, body });
  const owner = await fetch(`${origin}${SKILL_INSTALL_ACTION_PATH}`, { method: "POST", headers: { "content-type": "application/json", [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce, [ACTION_HEADERS.signature]: signature }, body });
  assert.equal(owner.status, 202);
  assert.equal(installs.length, 1);

  const toggleTimestamp = String(Date.now());
  const toggleNonce = crypto.randomUUID();
  const toggleBody = Buffer.from(JSON.stringify({ scope: "codex-user", sourceId: "codex-user", name: "demo", enabled: false, requestId: toggleNonce }));
  const toggleSignature = signPeerAction(key, { method: "POST", path: SKILL_TOGGLE_ACTION_PATH, timestamp: toggleTimestamp, nonce: toggleNonce, body: toggleBody });
  const ownerToggle = await fetch(`${origin}${SKILL_TOGGLE_ACTION_PATH}`, { method: "POST", headers: { "content-type": "application/json", [ACTION_HEADERS.timestamp]: toggleTimestamp, [ACTION_HEADERS.nonce]: toggleNonce, [ACTION_HEADERS.signature]: toggleSignature }, body: toggleBody });
  assert.equal(ownerToggle.status, 202);
  assert.deepEqual(await ownerToggle.json(), { status: "ok", enabled: false, restartRequired: true, accepted: true });
  assert.equal(toggles.length, 1);
});

test("Skill SSH requests stay on the remote loopback dashboard and validate references", () => {
  const transport = { type: "direct-ssh", host: "peer.local", user: "matrix", port: 22, dashboardPort: 47831 };
  assert.ok(sshSkillsArguments(transport).includes("http://127.0.0.1:47831/api/node/skills"));
  assert.ok(sshSkillContentArguments(transport, "codex-user", "demo").includes("http://127.0.0.1:47831/api/node/skills/content?scope=codex-user&sourceId=codex-user&name=demo"));
  assert.throws(() => sshSkillContentArguments(transport, "codex-user", "../demo"), /invalid/);
});
