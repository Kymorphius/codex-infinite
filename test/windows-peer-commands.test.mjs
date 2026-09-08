import test from "node:test";
import assert from "node:assert/strict";
import { normalizePeerDefinition } from "../src/peer-contract.mjs";
import { sshActionArguments, sshSnapshotArguments } from "../src/ssh-peer-commands.mjs";

test("Windows direct peers use encoded PowerShell while relay transport remains POSIX", () => {
  const peer = normalizePeerDefinition({
    id: "windows-pc", platform: "windows", name: "Windows Desktop",
    transports: [
      { type: "direct-ssh", host: "192.168.1.234", user: "admin", port: 22, dashboardPort: 47831 },
      { type: "ssh-relay", relayHost: "relay.example", relayUser: "root", relayPort: 22, forwardedPort: 47843 }
    ]
  });
  const direct = sshSnapshotArguments(peer.transports[0], { remotePlatform: peer.platform });
  assert.ok(direct.includes("powershell.exe"));
  assert.equal(direct.includes("/usr/bin/curl"), false);
  const script = Buffer.from(direct.at(-1), "base64").toString("utf16le");
  assert.match(script, /http:\/\/127\.0\.0\.1:47831\/api\/node\/snapshot/);
  assert.match(script, /\[Console\]::InputEncoding=\$utf8/);
  assert.match(script, /\[Console\]::OutputEncoding=\$utf8/);
  const action = sshActionArguments(peer.transports[0], {
    "x-codex-node-timestamp": "1",
    "x-codex-node-nonce": "nonce_1234567890123456",
    "x-codex-node-signature": "a".repeat(64)
  }, undefined, { remotePlatform: peer.platform });
  const actionScript = Buffer.from(action.at(-1), "base64").toString("utf16le");
  assert.match(actionScript, /ReadToEnd/);
  assert.match(actionScript, /\$bodyBytes=\$utf8\.GetBytes\(\$body\)/);
  assert.match(actionScript, /-Body \$bodyBytes/);
  assert.match(actionScript, /\[Console\]::InputEncoding=\$utf8/);
  assert.match(actionScript, /\[Console\]::OutputEncoding=\$utf8/);
  assert.match(actionScript, /\}catch\{/);
  assert.doesNotMatch(actionScript, /\};catch\{/);
  const relay = sshSnapshotArguments(peer.transports[1], { remotePlatform: peer.platform });
  assert.ok(relay.includes("/usr/bin/curl"));
});
