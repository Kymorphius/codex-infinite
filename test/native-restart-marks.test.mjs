import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeRestartMarksStoreSource, createNativeRestartMarksBinding, NATIVE_RESTART_MARKS_BINDING, respondToNativeRestartMarksBinding } from '../src/native-restart-marks.mjs';

const id = '00000000-0000-0000-0000-000000000001';

test('binding answers list and set requests and rejects malformed payloads without evaluating', async () => {
  const evaluated = [];
  const connection = { evaluate: async (script) => evaluated.push(script) };
  const calls = [];
  const service = { snapshot: async () => ({ marks: [] }), set: async (input) => { calls.push(input); return { marks: [{ id: input.id }] }; } };
  const binding = createNativeRestartMarksBinding(service);
  assert.equal(binding.name, NATIVE_RESTART_MARKS_BINDING);
  const response = await binding.handle(JSON.stringify({ id: 'a', kind: 'set', marked: true, conversationId: id, provider: 'local', title: 'T' }), connection);
  assert.deepEqual(response, { id: 'a', ok: true, marks: [{ id }] });
  assert.deepEqual(calls, [{ id, provider: 'local', deviceId: '', title: 'T', marked: true }]);
  assert.match(evaluated[0], /__codexControlConsoleResolveRestartMarks\?\.\(/);
  assert.equal(await respondToNativeRestartMarksBinding('{"id":"b","kind":"set"}', connection, service), null);
  assert.equal(evaluated.length, 1);
  const failing = await respondToNativeRestartMarksBinding('{"id":"c","kind":"list"}', connection, { snapshot: async () => { throw new Error('磁盘错误'); } });
  assert.deepEqual(failing, { id: 'c', ok: false, message: '磁盘错误' });
});

test('page store mirrors backend marks, toggles through the binding, and notifies subscribers', async () => {
  const sent = [];
  const window = { [NATIVE_RESTART_MARKS_BINDING]: (payload) => sent.push(JSON.parse(payload)) };
  const context = vm.createContext({ window, setTimeout, clearTimeout });
  vm.runInContext(buildNativeRestartMarksStoreSource(), context);
  const store = window.__codexControlConsoleRestartMarks;
  assert.equal(sent[0].kind, 'list');
  let notified = 0;
  store.subscribe(() => { notified++; });
  window.__codexControlConsoleResolveRestartMarks({ id: sent[0].id, ok: true, marks: [{ id, provider: 'local', title: 'T', markedAt: '2026-09-29T10:00:00.000Z' }] });
  assert.equal(store.get(id).title, 'T');
  assert.equal(notified, 1);
  const pending = store.toggle({ id, provider: 'local', title: 'T' });
  assert.equal(sent[1].marked, false);
  window.__codexControlConsoleResolveRestartMarks({ id: sent[1].id, ok: true, marks: [] });
  await pending;
  assert.equal(store.get(id), null);
  assert.equal(notified, 2);
  window.__codexControlConsoleResolveRestartMarks({ id: sent[1].id, ok: true, marks: [] });
  assert.equal(notified, 2, 'unchanged marks do not notify');
  vm.runInContext(buildNativeRestartMarksStoreSource(), context);
  assert.equal(window.__codexControlConsoleRestartMarks, store, 'reinjection keeps the same store');
  const failed = store.set({ id, provider: 'local' }, true);
  window.__codexControlConsoleResolveRestartMarks({ id: sent.at(-1).id, ok: false, message: '失败了' });
  await assert.rejects(failed, /失败了/);
});

test('page toggle cycles none, restart, none and resolves a verify mark as passed', async () => {
  const sent = [];
  const window = { [NATIVE_RESTART_MARKS_BINDING]: (payload) => sent.push(JSON.parse(payload)) };
  vm.runInContext(buildNativeRestartMarksStoreSource(), vm.createContext({ window, setTimeout, clearTimeout }));
  const store = window.__codexControlConsoleRestartMarks;
  const answer = (marks) => window.__codexControlConsoleResolveRestartMarks({ id: sent.at(-1).id, ok: true, marks });
  answer([]);
  const record = { id, provider: 'local', title: 'T' };
  const first = store.toggle(record); assert.deepEqual([sent.at(-1).kind, sent.at(-1).marked], ['set', true]);
  answer([{ id, provider: 'local', title: 'T', markedAt: '2026-09-29T10:00:00.000Z', status: 'restart' }]); await first;
  const second = store.toggle(record); assert.equal(sent.at(-1).marked, false);
  answer([{ id, provider: 'local', title: 'T', markedAt: '2026-09-29T10:00:00.000Z', status: 'verify' }]); await second;
  const third = store.toggle(record);
  assert.deepEqual([sent.at(-1).kind, sent.at(-1).outcome], ['resolve', 'passed']);
  answer([]); await third;
});
