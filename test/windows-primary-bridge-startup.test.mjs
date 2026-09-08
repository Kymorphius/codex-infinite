import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("Windows service startup projects the private primary bridge configuration", async () => {
  const script = await fs.readFile(new URL("../scripts/start-windows.ps1", import.meta.url), "utf8");
  for (const name of [
    "CODEX_CONTROL_PRIMARY_CDP_HOST",
    "CODEX_CONTROL_PRIMARY_CDP_PORT",
    "CODEX_CONTROL_PRIMARY_CDP_ENABLED",
    "CODEX_CONTROL_PRIMARY_PROFILE_DIR"
  ]) assert.match(script, new RegExp(`\\$env:${name}\\s*=`));
});

test("Windows installer records a disabled loopback-only primary bridge", async () => {
  const script = await fs.readFile(new URL("../scripts/install-windows.ps1", import.meta.url), "utf8");
  assert.match(script, /primaryCdpHost\s*=\s*'127\.0\.0\.1'/);
  assert.match(script, /primaryCdpPort\s*=\s*9232/);
  assert.match(script, /primaryCdpEnabled\s*=\s*\$false/);
  assert.match(script, /primaryProfileDirectory\s*=\s*\$primaryProfileDirectory/);
});

test("Windows primary bridge maintenance launch is explicit and loopback-only", async () => {
  const script = await fs.readFile(new URL("../scripts/start-windows-primary-bridge.ps1", import.meta.url), "utf8");
  assert.match(script, /\[switch\]\$ConfirmIdle/);
  assert.match(script, /if \(-not \$ConfirmIdle\)/);
  assert.match(script, /primaryCdpHost -ne '127\.0\.0\.1'/);
  assert.match(script, /--remote-debugging-address=127\.0\.0\.1/);
  assert.doesNotMatch(script, /Stop-Process|taskkill/i);
});
