import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizePeerDefinition } from "../src/peer-contract.mjs";
import { addLocalManagerTailscaleRoutes, resolveLocalManagerPeerRoutes } from "../src/localmanager-peer-directory.mjs";

function peer(overrides = {}) {
  return normalizePeerDefinition({
    id: "windows-pc",
    platform: "windows",
    name: "Windows",
    location: "远程",
    localManagerRegistrationId: "win234",
    transports: [
      { type: "direct-ssh", host: "192.168.1.234", user: "admin", port: 22, dashboardPort: 47831 },
      { type: "ssh-relay", relayHost: "relay.example", relayUser: "relay", relayPort: 22, forwardedPort: 47843 }
    ],
    ...overrides
  });
}

function directory(record = {}) {
  return {
    format: 1,
    devices: [{
      id: "bde3e15a4339ee40fff738e1ca59e274",
      registrationId: "win234",
      name: "display names are not identity",
      registered: true,
      identityConflict: false,
      bindings: [{ scope: "tailnet:tailnet-example.ts.net", nodeId: "nmdnSaAA6Q11CNTRL" }],
      addresses: ["192.168.1.234", "100.64.0.20", "fd7a:115c:a1e0::a13b:c416"],
      ...record
    }]
  };
}

test("registered LocalManager device adds Tailscale before relay", () => {
  const [resolved] = addLocalManagerTailscaleRoutes([peer()], directory());
  assert.deepEqual(resolved.transports.map((item) => [item.type, item.host || item.relayHost]), [
    ["direct-ssh", "192.168.1.234"],
    ["direct-ssh", "100.64.0.20"],
    ["ssh-relay", "relay.example"]
  ]);
  assert.deepEqual(resolved.transports[1], { type: "direct-ssh", host: "100.64.0.20", user: "admin", port: 22, dashboardPort: 47831 });
});

test("directory evidence never creates trust from names or discovery alone", () => {
  for (const record of [
    { registrationId: "other" },
    { registered: false },
    { identityConflict: true },
    { addresses: ["192.168.1.234", "203.0.113.10"] }
  ]) {
    assert.equal(addLocalManagerTailscaleRoutes([peer()], directory(record))[0].transports.length, 2);
  }
  const duplicate = directory();
  duplicate.devices.push({ ...duplicate.devices[0], addresses: ["100.100.100.100"] });
  assert.equal(addLocalManagerTailscaleRoutes([peer()], duplicate)[0].transports.length, 2);
});

test("explicit stable device binding can use a discovered LocalManager record", () => {
  const source = peer({ localManagerRegistrationId: null, localManagerDeviceId: "bde3e15a4339ee40fff738e1ca59e274" });
  const discovered = directory({ registrationId: null, registered: false });
  assert.equal(addLocalManagerTailscaleRoutes([source], discovered)[0].transports[1].host, "100.64.0.20");
  discovered.devices[0].bindings = [];
  assert.equal(addLocalManagerTailscaleRoutes([source], discovered)[0].transports.length, 2);
});

test("duplicate and full route lists remain bounded", () => {
  assert.equal(addLocalManagerTailscaleRoutes([peer({ transports: [
    { type: "direct-ssh", host: "100.64.0.20", user: "admin", port: 22, dashboardPort: 47831 },
    { type: "ssh-relay", relayHost: "relay.example", relayUser: "relay", relayPort: 22, forwardedPort: 47843 }
  ] })], directory())[0].transports.length, 2);
  const full = peer({ transports: [
    { type: "direct-ssh", host: "192.168.1.234", user: "admin", port: 22, dashboardPort: 47831 },
    { type: "direct-ssh", host: "192.168.2.234", user: "admin", port: 22, dashboardPort: 47831 },
    { type: "ssh-relay", relayHost: "relay.example", relayUser: "relay", relayPort: 22, forwardedPort: 47843 },
    { type: "ssh-relay", relayHost: "relay2.example", relayUser: "relay", relayPort: 22, forwardedPort: 47844 }
  ] });
  assert.equal(addLocalManagerTailscaleRoutes([full], directory())[0].transports.length, 4);
});

test("file adapter preserves static peers when snapshot is missing or invalid", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "localmanager-peer-directory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = peer();
  assert.equal((await resolveLocalManagerPeerRoutes([source], { filePath: path.join(root, "missing.json") }))[0], source);
  const invalid = path.join(root, "invalid.json");
  await fs.writeFile(invalid, JSON.stringify({ format: 2, devices: [] }));
  const warnings = [];
  assert.equal((await resolveLocalManagerPeerRoutes([source], { filePath: invalid, logger: { warn: (message) => warnings.push(message) } }))[0], source);
  assert.equal(warnings.length, 1);
});

test("file adapter reads a valid bounded snapshot", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "localmanager-peer-directory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "device-directory.json");
  await fs.writeFile(file, JSON.stringify(directory()));
  const [resolved] = await resolveLocalManagerPeerRoutes([peer()], { filePath: file });
  assert.equal(resolved.transports[1].host, "100.64.0.20");
});
