import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectChecklistStore } from '../src/project-checklist-store.mjs';
import { normalizeChecklistAction } from '../src/project-checklist-contract.mjs';
import { syncProjectChecklist } from '../src/project-checklist-sync.mjs';
import { assignedChecklistTasksForThread } from '../src/project-checklist-assignment.mjs';

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

test('initial added time survives edits, completion, assignments, returns and request replay', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-time-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
  const createdAt = '2026-09-01T02:03:04.005Z';
  const action = { projectKey: 'general', id: 'task-1', requestId: 'add', type: 'upsert', text: '最初内容', done: false, createdAt, createdAtEstimated: false };
  await store.apply(action);
  const changes = [{ text: '编辑内容' }, { done: true }, { done: false, assignedThreadId: threadId }, { assignedThreadId: null }];
  for (const [index, change] of changes.entries()) {
    const current = (await store.read('general')).items[0];
    await store.apply({ ...action, ...current, ...change, requestId: 'edit-' + index, createdAt: '2026-09-22T00:00:00.000Z', createdAtEstimated: true });
    const saved = (await store.read('general')).items[0];
    assert.equal(saved.createdAt, createdAt); assert.equal(saved.createdAtEstimated, false);
    assert.equal(saved.text, '编辑内容');
  }
  const beforeReplay = await fs.readFile(store.file('general'), 'utf8');
  await store.apply(action);
  assert.equal(await fs.readFile(store.file('general'), 'utf8'), beforeReplay);
  assert.equal((await store.read('general')).items[0].assignedThreadId, null);
});

test('server stamps legacy new actions but preserves client creation time and pending estimates', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-time-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), base = { projectKey: 'general', id: 'task-1', requestId: 'add', type: 'upsert', text: '新任务', done: false };
  const before = Date.now(); await store.apply(base); const after = Date.now();
  const serverStamped = (await store.read('general')).items[0];
  assert.ok(Date.parse(serverStamped.createdAt) >= before && Date.parse(serverStamped.createdAt) <= after);
  assert.equal(serverStamped.createdAtEstimated, false);
  assert.equal(serverStamped.createdAt, serverStamped.updatedAt);
  await store.apply({ ...base, id: 'task-2', requestId: 'add-estimate', createdAt: '2026-09-01T10:03:04.005+08:00', createdAtEstimated: true });
  await store.apply({ ...base, id: 'task-3', requestId: 'add-unknown', createdAt: null });
  const items = (await store.read('general')).items;
  assert.equal(items[1].createdAt, '2026-09-01T02:03:04.005Z'); assert.equal(items[1].createdAtEstimated, true);
  assert.equal(items[2].createdAt, null); assert.equal(items[2].createdAtEstimated, false);
});

test('reading legacy records is non-mutating and the first write freezes estimated or unknown time', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-time-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), initial = '2026-09-01T02:03:04.005Z';
  const items = [{ id: 'estimated', text: '旧任务', done: false, updatedAt: initial }, { id: 'unknown', text: '无时间任务', done: false }];
  const original = JSON.stringify({ version: 1, items, receipts: [] });
  await fs.writeFile(store.file('general'), original);
  const first = await store.read('general');
  assert.equal(await fs.readFile(store.file('general'), 'utf8'), original);
  assert.equal(first.items[0].createdAt, initial); assert.equal(first.items[0].createdAtEstimated, true);
  assert.equal(first.items[1].createdAt, null); assert.equal(first.items[1].createdAtEstimated, false);
  for (const item of items) {
    await store.apply({ ...item, projectKey: 'general', requestId: 'edit-' + item.id, type: 'upsert', text: '新内容' });
    await store.apply({ ...item, projectKey: 'general', requestId: 'edit-again-' + item.id, type: 'upsert', text: '再编辑' });
  }
  const saved = JSON.parse(await fs.readFile(store.file('general'), 'utf8'));
  assert.equal(saved.items[0].createdAt, initial); assert.equal(saved.items[0].createdAtEstimated, true);
  assert.equal(saved.items[1].createdAt, null); assert.equal(saved.items[1].createdAtEstimated, false);
  assert.notEqual(saved.items[0].updatedAt, initial);
});

test('optional time metadata validates strictly without changing the shape of old actions', () => {
  const action = { projectKey: 'p', id: 'task', requestId: 'request', type: 'upsert', text: '任务', done: false };
  assert.deepEqual(normalizeChecklistAction(action), { ...action, assignedThreadId: null });
  for (const createdAt of ['bad', '2026-02-30T12:00:00.000Z', '2026-01-01', '2026-01-01T24:00:00.000Z', 0, {}, undefined]) {
    assert.throws(() => normalizeChecklistAction({ ...action, createdAt }), /加入时间/);
  }
  for (const createdAtEstimated of [null, 'true', 1, undefined]) assert.throws(() => normalizeChecklistAction({ ...action, createdAtEstimated }), /加入时间/);
  assert.equal(normalizeChecklistAction({ ...action, createdAt: null }).createdAt, null);
});

test('invalid stored creation time is rejected without replacing the original file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'checklist-time-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new ProjectChecklistStore(directory), item = { id: 'a', text: '任务', done: false, createdAt: 'bad' };
  const original = JSON.stringify({ version: 1, items: [item], receipts: [] }); await fs.writeFile(store.file('p'), original);
  await assert.rejects(store.apply({ ...item, projectKey: 'p', requestId: 'edit', type: 'upsert', createdAt: null }), /加入时间/);
  assert.equal(await fs.readFile(store.file('p'), 'utf8'), original);
});

test('assigned unfinished general tasks are normalized for their receiving conversation only', () => {
  const threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a';
  const tasks = assignedChecklistTasksForThread([
    { id: 'keep', text: '  已领取任务  ', done: false, assignedThreadId: threadId },
    { id: 'done', text: '已完成任务', done: true, assignedThreadId: threadId },
    { id: 'other', text: '别的会话', done: false, assignedThreadId: '01a0ac42-2552-7141-8ec9-12c50515ac4b' },
    { id: 'bad', text: '', done: false, assignedThreadId: threadId }
  ], threadId.toUpperCase());
  assert.deepEqual(tasks, [{ id: 'keep', text: '已领取任务' }]);
  assert.deepEqual(assignedChecklistTasksForThread(tasks, 'not-a-thread'), []);
});
test('bridge does not install or mutate outside exact app page', async () => {
  const calls = []; await syncProjectChecklist({ evaluate: async code => { calls.push(code); return false; } }, { apply() { throw Error('must not write'); } });
  assert.equal(calls.length, 1);
});

test('checklist sync publishes only unfinished unassigned general tasks to the composer', async () => {
  const calls = [], threadId = '01a0ac42-2552-7141-8ec9-12c50515ac4a'; const store = { async read(key) { return { items: key === 'ccc:general-inbox:v1' ? [{ id: 'free', text: '未领取', done: false }, { id: 'done', text: '已完成', done: true }, { id: 'claimed', text: '已领取', done: false, assignedThreadId: threadId }] : [] }; }, async apply() {} };
  await syncProjectChecklist({ evaluate: async code => { calls.push(code); if (code.includes("location.href")) return true; if (code.includes('window.__cccProjectChecklist?.packet()')) return {}; if (code.includes('data-above-composer-conversation-id')) return threadId; return false; } }, store);
  assert.ok(calls.some(code => code.includes('__codexControlConsoleSetClaimableTaskCount?.(1)')));
  assert.ok(calls.some(code => code.includes('__cccProjectChecklist?.cacheGeneral(')));
  assert.ok(calls.some(code => code.includes(`__codexControlConsoleSetAssignedChecklistTasks?.(${JSON.stringify({ threadId, items: [{ id: 'claimed', text: '已领取' }] })})`)));
});

test('sync republishes an unchanged general snapshot after renderer replacement', async () => {
  const calls = []; let instanceId = 'first';
  const connection = { async evaluate(code) {
    calls.push(code);
    if (code.includes('location.href')) return true;
    if (code === 'window.__cccProjectChecklist?.packet()') return { instanceId, actions: [] };
    return null;
  } };
  const store = { async read() { return { items: [{ id: 'task', text: '任务', done: false }] }; } };
  await syncProjectChecklist(connection, store);
  await syncProjectChecklist(connection, store);
  assert.equal(calls.filter(code => code.includes('__cccProjectChecklist?.cacheGeneral(')).length, 1);
  instanceId = 'second';
  await syncProjectChecklist(connection, store);
  assert.equal(calls.filter(code => code.includes('__cccProjectChecklist?.cacheGeneral(')).length, 2);
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
