import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeComposerHeldQueueInjectionScript } from '../src/native-composer-held-queue.mjs';

test('already open pre-federation windows must install the versioned delivery guard without app restart', () => {
  const script = buildNativeComposerHeldQueueInjectionScript();
  const window = {
    __codexControlConsoleHeldQueueInstalledVersion: '2026-09-24.queue-label1',
    __codexControlConsoleSaveDraftTodoInstalledVersion: '2026-09-23.reassign1',
    __codexControlConsoleHeldQueueObserver: { disconnect() { throw Error('upgrade reached'); } },
    __codexControlConsoleSaveDraftTodoObserver: {}
  };
  assert.throws(() => vm.runInNewContext(script, { window }), /upgrade reached/);
  window.__codexControlConsoleHeldQueueInstalledVersion = '2026-09-26.federated-delivery1';
  assert.doesNotThrow(() => vm.runInNewContext(script, { window }));
});
