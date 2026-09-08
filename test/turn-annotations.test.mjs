import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TurnAnnotationStore } from '../src/turn-annotation-store.mjs';
import { normalizeAnnotationAction } from '../src/turn-annotation-contract.mjs';
import { syncTurnAnnotations } from '../src/turn-annotation-sync.mjs';
import { readNativeAnnotationContext } from '../src/native-turn-annotation-adapter.mjs';
import { buildNativeTurnAnnotationsScript } from '../src/native-turn-annotations.mjs';
const threadId = '01a06856-3552-7180-8fe5-20b74987e2af';
const turnId = '01a06856-63e5-7a13-a3a9-90bbf2138fdc';
const other = '01a06858-4767-7de2-834e-366866520195';
const action = { threadId, turnId, text: '当时的想法 <script>', requestId: 'request-1' };
test('annotation store serializes independent turns, survives restart and deletes only the chosen note', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'annotations-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new TurnAnnotationStore(directory);
  await Promise.all([store.apply(action), store.apply({ ...action, turnId: other, text: 'another' }), store.apply({ ...action, threadId: other, text: 'other thread' })]);
  const restored = new TurnAnnotationStore(directory);
  assert.equal((await restored.read(threadId)).notes[turnId].text, action.text);
  assert.equal((await restored.read(other)).notes[turnId].text, 'other thread');
  await restored.apply({ ...action, text: ' ' });
  assert.deepEqual(Object.keys((await restored.read(threadId)).notes), [other]);
  assert.equal((await restored.read(other)).notes[turnId].text, 'other thread');
  assert.ok((await fs.readdir(directory)).every(file => file.endsWith('.json')));
});
test('invalid paths and oversized input are rejected; corrupt persisted notes are never overwritten', async t => {
  assert.throws(() => normalizeAnnotationAction({ ...action, threadId: '../oops' }));
  assert.throws(() => normalizeAnnotationAction({ ...action, text: 'x'.repeat(20001) }));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'annotations-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, threadId + '.json'); await fs.writeFile(file, 'corrupt');
  await assert.rejects(new TurnAnnotationStore(directory).apply(action)); assert.equal(await fs.readFile(file, 'utf8'), 'corrupt');
});
test('CDP sync acknowledges only durable actions and preserves failed drafts without exposing contents', async () => {
  let response; const writes = [];
  const connection = { async evaluate(code) {
    if (code.startsWith('location.href')) return true;
    if (code.endsWith('?.packet()')) return { threadId, actions: [action, { ...action, requestId: 'bad' }] };
    if (code.startsWith('window.__codexControlConsoleAnnotations?.accept(')) response = JSON.parse(code.slice(code.indexOf('(') + 1, -1));
  } };
  await syncTurnAnnotations(connection, { async apply(a) { writes.push(a); if (a.requestId === 'bad') throw Error(a.text); return a.requestId; }, async read() { return { notes: {} }; } });
  assert.equal(writes.length, 2); assert.deepEqual(response.acknowledged, ['request-1']); assert.ok(response.error); assert.ok(!response.error.includes(action.text));
  let accessed = false;
  await syncTurnAnnotations({ evaluate: async () => false }, { read() { accessed = true; } }); assert.equal(accessed, false);
});
test('native identity comes from the rendered local conversation and maps duplicate message ticks to stable turns', () => {
  const marker = suffix => ({ getBoundingClientRect: () => ({ width: 20 }), getAttribute: () => turnId + ':' + suffix });
  const markers = [marker('message1'), marker('message2')];
  const anchor = { getAttribute: () => 'history-content:turn:' + turnId };
  const content = { __reactFiberTest: { memoizedProps: {}, return: { memoizedProps: { conversationId: threadId, hostId: 'local' } } }, closest: () => null, querySelectorAll: () => [anchor, { getAttribute: () => 'history-content:tail:0:local:' + other }] };
  const document = { querySelector: selector => selector.includes('workspace') ? null : content, querySelectorAll: () => markers };
  const result = readNativeAnnotationContext(document); assert.equal(result.threadId, threadId); assert.equal(result.turns.length, 1); assert.equal(result.turns[0].markers.length, 2); assert.equal(result.turns[0].anchor, anchor);
  content.__reactFiberTest.return.memoizedProps.hostId = 'remote'; assert.equal(readNativeAnnotationContext(document), null);
  assert.doesNotThrow(() => new Function(buildNativeTurnAnnotationsScript()));
});
