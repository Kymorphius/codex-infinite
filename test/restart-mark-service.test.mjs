import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeRestartMarkState, parseRestartMarkRequest, reconcileRestartMarks, MAX_RESTART_MARKS } from '../src/restart-mark-contract.mjs';
import { RestartMarkStore } from '../src/restart-mark-store.mjs';
import { RestartMarkService } from '../src/restart-mark-service.mjs';
import { createAppInstanceReader } from '../src/app-instance.mjs';

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const mark = (n, extra = {}) => ({ id: id(n), provider: 'local', title: `会话 ${n}`, markedAt: `2026-09-29T10:0${n}:00.000Z`, ...extra });

test('state normalization keeps only valid, bounded marks and strips control characters', () => {
  const marks = { a: mark(1, { title: 'bad\u0000title' }), b: { ...mark(2), provider: 'chatgpt' }, c: { ...mark(3), id: 'nope' }, d: { ...mark(4), markedAt: 'x' }, e: { ...mark(5), sourceFile: '/private' } };
  const state = normalizeRestartMarkState({ appInstance: '1@t', marks });
  assert.deepEqual(Object.keys(state.marks), [id(1), id(5)]);
  assert.equal(state.marks[id(1)].title, 'bad title');
  assert.equal('sourceFile' in state.marks[id(5)], false);
  const many = Object.fromEntries(Array.from({ length: MAX_RESTART_MARKS + 20 }, (_, i) => [i, mark(1, { id: `10000000-0000-0000-0000-${String(i).padStart(12, '0')}` })]));
  assert.equal(Object.keys(normalizeRestartMarkState({ marks: many }).marks).length, MAX_RESTART_MARKS);
  assert.deepEqual(normalizeRestartMarkState(null), { version: 1, appInstance: null, marks: {} });
});

test('reconcile converts pending restarts to verify only when a known instance differs', () => {
  const state = normalizeRestartMarkState({ appInstance: '1@a', marks: { x: mark(1) } });
  assert.equal(reconcileRestartMarks(state, '1@a'), state);
  assert.equal(reconcileRestartMarks(state, null), state);
  const restarted = reconcileRestartMarks(state, '2@b', '2026-09-29T13:00:00.000Z');
  assert.equal(restarted.appInstance, '2@b');
  assert.deepEqual([restarted.marks[id(1)].status, restarted.marks[id(1)].restartedAt], ['verify', '2026-09-29T13:00:00.000Z']);
  const again = reconcileRestartMarks(restarted, '3@c', '2026-09-29T14:00:00.000Z');
  assert.equal(again.marks[id(1)].restartedAt, '2026-09-29T13:00:00.000Z', 'a verify mark survives further restarts unchanged');
  const unknown = normalizeRestartMarkState({ marks: { x: mark(1) } });
  assert.deepEqual(Object.keys(reconcileRestartMarks(unknown, '2@b').marks), [id(1)]);
});

test('requests are parsed strictly', () => {
  const good = { id: 'r1', kind: 'set', marked: true, conversationId: id(1).toUpperCase(), provider: 'terminal', title: 'T' };
  assert.deepEqual(parseRestartMarkRequest(JSON.stringify(good)), { id: 'r1', kind: 'set', marked: true, conversationId: id(1), provider: 'terminal', deviceId: '', title: 'T' });
  assert.deepEqual(parseRestartMarkRequest('{"id":"r2","kind":"list"}'), { id: 'r2', kind: 'list' });
  assert.deepEqual(parseRestartMarkRequest(JSON.stringify({ id: 'r3', kind: 'resolve', conversationId: id(1), outcome: 'failed' })), { id: 'r3', kind: 'resolve', conversationId: id(1), outcome: 'failed' });
  assert.equal(parseRestartMarkRequest(JSON.stringify({ id: 'r3', kind: 'resolve', conversationId: id(1), outcome: 'maybe' })), null);
  for (const bad of [null, '{', '[]', { ...good, marked: 'yes' }, { ...good, provider: 'shell' }, { ...good, conversationId: 'x' }, { ...good, id: '' }, { ...good, kind: 'other' }]) {
    assert.equal(parseRestartMarkRequest(typeof bad === 'string' || bad === null ? bad : JSON.stringify(bad)), null);
  }
});

async function fixture(instance = { value: '1@a' }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-marks-'));
  const filePath = path.join(dir, 'nested', 'restart-marks.json');
  const service = new RestartMarkService({ store: new RestartMarkStore({ filePath }), readAppInstance: async () => instance.value, clock: () => new Date('2026-09-29T12:00:00.000Z') });
  return { dir, filePath, service, instance };
}

test('marks toggle, persist privately, and turn into verify marks after an app restart', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  assert.deepEqual(await f.service.snapshot(), { marks: [] });
  await f.service.set({ id: id(1), provider: 'local', title: 'One', marked: true });
  const second = await f.service.set({ id: id(2), provider: 'terminal', deviceId: 'dev', title: 'Two', marked: true });
  assert.deepEqual(second.marks.map((item) => item.id), [id(1), id(2)]);
  // Windows exposes synthetic POSIX mode bits; NTFS access is controlled by ACLs.
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.filePath)).mode & 0o777, 0o600);
  const remarked = await f.service.set({ id: id(1), provider: 'local', title: 'One renamed', marked: true });
  assert.equal(remarked.marks.find((item) => item.id === id(1)).markedAt, '2026-09-29T12:00:00.000Z');
  assert.deepEqual((await f.service.set({ id: id(1), provider: 'local', marked: false })).marks.map((item) => item.id), [id(2)]);
  f.instance.value = null;
  assert.equal((await f.service.snapshot()).marks.length, 1, 'unknown instance keeps marks');
  f.instance.value = '1@a';
  assert.equal((await f.service.snapshot()).marks.length, 1, 'same instance keeps marks');
  f.instance.value = '2@b';
  const converted = (await f.service.snapshot()).marks;
  assert.deepEqual(converted.map((item) => [item.id, item.status, item.restartedAt]), [[id(2), 'verify', '2026-09-29T12:00:00.000Z']]);
  assert.equal(JSON.parse(await fs.readFile(f.filePath, 'utf8')).appInstance, '2@b');
  f.instance.value = '3@c';
  assert.equal((await f.service.snapshot()).marks[0].status, 'verify', 'verify marks are never cleared by a restart');
});

test('the user resolves a verify mark: passed removes it, failed asks for another restart', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  for (const n of [1, 2]) await f.service.set({ id: id(n), provider: 'local', title: `T${n}`, marked: true });
  await f.service.resolve({ id: id(1), outcome: 'passed' });
  assert.equal((await f.service.snapshot()).marks.length, 2, 'a pending restart mark cannot be resolved');
  f.instance.value = '2@b';
  await f.service.snapshot();
  assert.deepEqual((await f.service.resolve({ id: id(1), outcome: 'passed' })).marks.map((item) => item.id), [id(2)]);
  const failed = (await f.service.resolve({ id: id(2), outcome: 'failed' })).marks[0];
  assert.deepEqual([failed.status, 'restartedAt' in failed], ['restart', false]);
  f.instance.value = '3@c';
  assert.equal((await f.service.snapshot()).marks[0].status, 'verify');
});

test('a corrupt file reads as empty and the limit is enforced', async (t) => {
  const f = await fixture();
  t.after(() => fs.rm(f.dir, { recursive: true, force: true }));
  await fs.mkdir(path.dirname(f.filePath), { recursive: true });
  await fs.writeFile(f.filePath, '{broken');
  assert.deepEqual(await f.service.snapshot(), { marks: [] });
  await assert.rejects(f.service.set({ id: 'bad', provider: 'local', marked: true }), /无效/);
});

test('app instance combines pid and start time, caches, and never invents one on failure', async () => {
  let calls = 0, now = 0;
  const exec = async () => ({ stdout: 'Mon Sep 29 10:00:00 2026\n' });
  const read = createAppInstanceReader({ config: {}, platform: 'darwin', exec, inspect: async () => { calls++; return { pid: 42 }; }, clock: () => now });
  assert.equal(await read(), '42@Mon Sep 29 10:00:00 2026');
  await read(); assert.equal(calls, 1);
  now = 6000; await read(); assert.equal(calls, 2);
  const failing = createAppInstanceReader({ config: {}, platform: 'darwin', exec, inspect: async () => { throw new Error('no'); }, clock: () => 0 });
  assert.equal(await failing(), null);
  const windows = createAppInstanceReader({ config: {}, platform: 'win32', exec, inspect: async () => ({ pid: 7 }), clock: () => 0 });
  assert.equal(await windows(), '7');
});
