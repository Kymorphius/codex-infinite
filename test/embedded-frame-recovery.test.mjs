import test from "node:test";
import assert from "node:assert/strict";
import { buildEmbeddedFrameRecoveryInjectionSource } from "../src/embedded-frame-recovery.mjs";

test("embedded frame recovery requires a handshake and schedules one stable remount", () => {
  const source = buildEmbeddedFrameRecoveryInjectionSource();
  assert.match(source, /FRAME_READY_TYPE = 'codex-control-console-ready'/);
  assert.match(source, /event\.origin !== DASHBOARD_ORIGIN/);
  assert.match(source, /data-codex-control-console-frame-recovery-request/);
  assert.match(source, /function cancelEmbeddedFrameRecovery\(\)/);
  assert.match(source, /sessionStorage\.removeItem\(FRAME_RECOVERY_KEY\)/);
  assert.match(source, /frameRecoverySchedulePending/);
  assert.match(source, /if \(window\.__codexControlConsoleCspDocumentPrepared\) return false/);
  assert.match(source, /document\.body\.setAttribute\('data-codex-control-console-frame-recovery-request'/);
  assert.match(source, /pendingFrameRecovery && canRestore\(\)/);
  assert.doesNotMatch(source, /location\.reload/);
});
