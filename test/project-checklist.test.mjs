import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { normalizeChecklistAction } from '../src/project-checklist-contract.mjs';
import { syncProjectChecklist } from '../src/project-checklist-sync.mjs';

test('checklists isolate projects, persist edits and completion, delete and replay safely', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory);
  const action = { projectKey: '../../project', id: 'task-1', requestId: 'request-1', type: 'upsert', text: '第一件事', done: false };
  await store.apply(action);
  assert.equal(path.dirname(store.file(action.projectKey)), directory);
  await store.apply({ ...action, requestId: 'request-2', text: '修改后的任务', done: true });
  await store.apply(action);
  assert.equal((await store.read(action.projectKey)).items[0].done, true);
  assert.equal((await store.read(action.projectKey)).items[0].text, '修改后的任务');
  assert.equal((await store.read('another')).items.length, 0);
  assert.equal((await new ProjectChecklistStore(directory).read(action.projectKey)).items.length, 1);
  await store.apply({ ...action, requestId: 'request-3', type: 'delete' });
  assert.equal((await store.read(action.projectKey)).items.length, 0);
});
test('invalid input and corrupt stores are rejected without overwrite', async t => {
  assert.throws(() => normalizeChecklistAction({}));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), action = { projectKey: 'p', id: 'a', requestId: 'a', type: 'upsert', text: 'a', done: false };
  for (const patch of [{ text: '' }, { text: 'x'.repeat(5001) }, { done: 'yes' }, { id: '../x' }, { type: 'other' }]) assert.throws(() => store.apply({ ...action, ...patch }));
  await fs.writeFile(store.file('p'), 'broken');
  await assert.rejects(store.apply(action));
  assert.equal(await fs.readFile(store.file('p'), 'utf8'), 'broken');
});
test('bridge does not install or mutate outside exact app page', async () => {
  const calls = []; await syncProjectChecklist({ evaluate: async code => { calls.push(code); return false; } }, { apply() { throw Error('must not write'); } });
  assert.equal(calls.length, 1);
});

test('catalog identity resolves to native sidebar ID and ignores remote host mappings', async t => {
  const { readChecklistProjectIds } = await import('../src/project-checklist-identity.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  await fs.writeFile(file, JSON.stringify({ 'app-server-project-id-by-legacy-project-id-by-host': { 'local:/home': { native: 'server' }, remote: { unrelated: 'server' } } }));
  assert.equal((await readChecklistProjectIds([file])).get('server'), 'native');
});
