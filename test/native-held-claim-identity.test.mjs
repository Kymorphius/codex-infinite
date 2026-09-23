import test from 'node:test';
import assert from 'node:assert/strict';
import { heldRuntimeHarness } from './support/held-runtime-harness.mjs';
import { readNativeComposerThreadId } from '../src/native-composer-thread-id.mjs';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const a = { id: 'task-a', text: '其他会话任务' }, b = { id: 'task-b', text: 'jev 分类任务' };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the installed claim button and checklist sync resolve the same last mounted composer', () => {
  const h = heldRuntimeHarness([A, B]);
  h.find('[data-ccc-claim-task]').click();
  assert.deepEqual(h.claims, [B]);
  assert.equal(h.claims[0], readNativeComposerThreadId(h.document));
  h.publish({ threadId: B, items: [b] });
  assert.deepEqual(h.texts(), [b.text]);
  assert.equal(h.find('[data-ccc-held-queue-button]').textContent, '待办 1');
});

test('a hot upgrade replaces the old claim button and its first-composer closure', () => {
  const h = heldRuntimeHarness([A, B]), old = h.find('[data-ccc-claim-task]');
  // A mounted .9 button retained a click closure over the first-composer rule.
  old.events.click.clear(); old.addEventListener('click', () => h.window.__cccProjectChecklist.openClaimableForCurrentThread(A));
  h.window.__codexControlConsoleHeldQueueInstalledVersion = '2026-09-22.9';
  h.reinject();
  const current = h.find('[data-ccc-claim-task]');
  assert.notEqual(current, old); assert.equal(old.parentElement, null);
  current.click(); assert.deepEqual(h.claims, [B]);
  assert.equal(h.document.querySelectorAll('[data-ccc-claim-task]').length, 1);
});

test('navigation removes old assigned rows immediately and a detached resume callback cannot send', () => {
  const h = heldRuntimeHarness([A]);
  h.publish({ threadId: A, items: [a] });
  const oldResume = Array.from(h.find('[data-ccc-held-actions]').children).find(button => button.textContent === '入队');
  h.navigate(B);
  oldResume.click(); // before the mutation observer has run
  assert.equal(h.requests.length, 0);
  h.notify();
  assert.deepEqual(h.texts(), []);
  assert.equal(h.find('[data-ccc-held-queue-button]').textContent, '待办 0');
  h.publish({ threadId: B, items: [b] });
  h.publish({ threadId: A, items: [a] });
  assert.deepEqual(h.texts(), [b.text]);
});

test('publishing after a route change isolates state even before the observer and leaves identical DOM intact', () => {
  const h = heldRuntimeHarness([A]);
  h.publish({ threadId: A, items: [a] });
  h.navigate(B); h.publish({ threadId: B, items: [b] });
  assert.deepEqual(h.texts(), [b.text]);
  const panel = h.find('[data-ccc-held-queue-panel]'), count = panel.replacements;
  h.publish({ threadId: B, items: [b] }); h.notify();
  assert.equal(panel.replacements, count);
  h.navigate(null); h.notify();
  assert.equal(h.find('[data-ccc-held-queue-panel]'), null);
  h.navigate(A); h.notify();
  assert.deepEqual(h.texts(), []);
});

test('a late native queue response cannot replace the new conversation todo panel', async () => {
  const h = heldRuntimeHarness([A]);
  const refresh = h.window.__codexControlConsoleRefreshHeldQueue();
  const oldList = h.requests[0];
  h.navigate(B); h.notify(); h.publish({ threadId: B, items: [b] });
  h.respond(oldList, { data: [{ id: 'queue-a', input: [{ type: 'text', text: '旧队列' }] }] });
  await refresh;
  assert.deepEqual(h.texts(), [b.text]);
});

test('current assigned resume sends the displayed task to its owner, then completes that exact identity', async () => {
  const h = heldRuntimeHarness([A, B]);
  h.publish({ threadId: B, items: [b] });
  Array.from(h.find('[data-ccc-held-actions]').children).find(button => button.textContent === '入队').click();
  const add = h.requests[0];
  assert.equal(add.method, 'thread/queue/add'); assert.equal(add.params.threadId, B);
  assert.equal(add.params.input[0].text, b.text);
  h.respond(add, {}); await tick();
  assert.deepEqual(h.completions, [[b.id, B, b.text]]);
  const list = h.requests[1]; assert.equal(list.method, 'thread/queue/list');
  h.respond(list, { data: [{ id: 'queue-b', input: [{ type: 'text', text: b.text }] }] });
  await tick();
  assert.deepEqual(h.texts(), [b.text]);
  assert.equal(h.find('[data-ccc-held-kind]').textContent, '排队');
});
