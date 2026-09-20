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

test('general checklist assignment persists without changing completion', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
  await store.apply({ projectKey: 'ccc:general-inbox:v1', id: 'task-1', requestId: 'request-1', type: 'upsert', text: '等待领取', done: false, assignedThreadId: threadId });
  const item = (await store.read('ccc:general-inbox:v1')).items[0];
  assert.equal(item.assignedThreadId, threadId); assert.equal(item.done, false);
});
test('bridge does not install or mutate outside exact app page', async () => {
  const calls = []; await syncProjectChecklist({ evaluate: async code => { calls.push(code); return false; } }, { apply() { throw Error('must not write'); } });
  assert.equal(calls.length, 1);
});

test('checklist sync publishes only unfinished unassigned general tasks to the composer', async () => {
  const calls = []; const store = { async read(key) { return { items: key === 'ccc:general-inbox:v1' ? [{ done: false }, { done: true }, { done: false, assignedThreadId: '01a0ac42-2552-7141-8ec9-12c50515ac4a' }] : [] }; }, async apply() {} };
  await syncProjectChecklist({ evaluate: async code => { calls.push(code); if (code.includes("location.href")) return true; if (code.includes('window.__cccProjectChecklist?.packet()')) return {}; return false; } }, store);
  assert.ok(calls.some(code => code.includes('__codexControlConsoleSetClaimableTaskCount?.(1)')));
});

test('catalog identity resolves to native sidebar ID and ignores remote host mappings', async t => {
  const { readChecklistProjectIds, readProjectStateIdentities } = await import('../src/project-checklist-identity.mjs');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json');
  await fs.writeFile(file, JSON.stringify({
    'app-server-project-id-by-legacy-project-id-by-host': { 'local:/home': { native: 'server' }, remote: { unrelated: 'server' } },
    'thread-project-assignments': {
      assigned: { projectKind: 'local', projectId: 'native' },
      remote: { projectKind: 'remote', projectId: 'native' },
      missing: { projectKind: 'local', projectId: 'missing' }
    }
  }));
  assert.equal((await readChecklistProjectIds([file])).get('server'), 'native');
  assert.deepEqual([...(await readProjectStateIdentities([file])).threadProjectIds], [['assigned', 'server']]);
});
