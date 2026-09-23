import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectChecklistSyncWake, PROJECT_CHECKLIST_SYNC_BINDING } from '../src/project-checklist-sync-wake.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('return wake waits for an active periodic pass, then runs without the poll timer', async () => {
  let periodicBusy = true, runs = 0;
  const wake = createProjectChecklistSyncWake({ canRun: () => !periodicBusy, run: async () => { runs++; }, onError: () => {} });
  wake.request(); wake.request();
  assert.equal(runs, 0);
  periodicBusy = false;
  await wake.resume();
  assert.equal(runs, 1);
  assert.equal(wake.busy(), false);
});

test('wake signals during an in-flight checklist sync coalesce into one follow-up', async () => {
  const first = deferred(); let runs = 0;
  const wake = createProjectChecklistSyncWake({ canRun: () => true, run: () => { runs++; return runs === 1 ? first.promise : Promise.resolve(); }, onError: () => {} });
  wake.request(); await Promise.resolve();
  wake.request(); wake.request();
  assert.equal(runs, 1);
  first.resolve(); await wake.settle();
  assert.equal(runs, 2);
});

test('failed immediate sync does not spin and later poll or wake may retry', async () => {
  let runs = 0, errors = 0;
  const wake = createProjectChecklistSyncWake({ canRun: () => true, run: async () => { if (++runs === 1) throw Error('offline'); }, onError: () => { errors++; } });
  wake.request(); await wake.settle();
  assert.equal(runs, 1); assert.equal(errors, 1);
  wake.request(); await wake.settle();
  assert.equal(runs, 2);
  assert.equal(PROJECT_CHECKLIST_SYNC_BINDING, 'codexControlConsoleChecklistSync');
});
