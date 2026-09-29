import test from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../test-support/native-project-checklist-harness.mjs';

test('a closed checklist does not rebuild its hidden dialog on every sync', () => {
  // Regression: `loaded` starts as '' and a closed dialog has no project, so `loaded !== project?.key`
  // was always true and each service sync (about once a second) re-rendered the whole hidden list,
  // invalidating style page-wide (~80ms each).
  const h = harness(); const key = 'ccc:general-inbox:v1';
  const sync = (result = { acknowledged: [], rejected: [], conflicts: [], actionResults: [], error: '' }) => h.api.accept(result);
  sync(); const settled = h.created();
  for (let i = 0; i < 10; i++) sync();
  assert.equal(h.created(), settled, 'nothing is built while no project is open');
  h.api.openGeneral(); const opened = h.created();
  const loaded = { projectKey: key, items: [{ id: 't1', text: '任务', done: false, assignedThreadId: null }], acknowledged: [], rejected: [], conflicts: [], actionResults: [], error: '' };
  sync(loaded);
  assert.ok(h.created() > opened, 'the first data for an opened project is rendered');
  const rendered = h.created();
  for (let i = 0; i < 5; i++) sync(loaded);
  assert.equal(h.created(), rendered, 'identical data is not re-rendered');
  sync({ ...loaded, items: [...loaded.items, { id: 't2', text: '另一项', done: false, assignedThreadId: null }] });
  assert.ok(h.created() > rendered, 'changed data is');
});
