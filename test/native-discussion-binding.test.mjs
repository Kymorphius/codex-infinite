import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeDiscussionBinding, buildNativeDiscussionClientSource, NATIVE_DISCUSSION_BINDING } from '../src/native-discussion-binding.mjs';

const ID = '11111111-1111-4111-8111-111111111111';

function fixture({ trusted = true, service = {} } = {}) {
  const calls = [];
  const connection = { send: async (method, params) => {
    calls.push({ method, params });
    return method === 'Runtime.evaluate' && params.expression.startsWith('location.origin') ? { result: { value: trusted } } : {};
  } };
  return { calls, connection, binding: createNativeDiscussionBinding(service) };
}
const call = (id, operation, input) => JSON.stringify({ id, operation, input });
const responses = calls => calls.filter(item => item.params.expression.startsWith('window.__codexControlConsoleResolveDiscussion'))
  .map(item => JSON.parse(item.params.expression.slice(item.params.expression.indexOf('(') + 1, -1)));

test('a trusted page context gets a validated result delivered back into that same context', async () => {
  const seen = [];
  const { binding, connection, calls } = fixture({ service: { forward: async input => { seen.push(input); return { forwarded: true }; } } });
  assert.equal(binding.name, NATIVE_DISCUSSION_BINDING);
  await binding.handle(call('r1', 'forward', { id: ID.toUpperCase(), from: 'gpt', comment: ' 好 ' }), connection, { executionContextId: 7 });
  assert.deepEqual(seen, [{ id: ID, from: 'gpt', comment: '好' }]);
  assert.deepEqual(responses(calls), [{ id: 'r1', ok: true, result: { forwarded: true } }]);
  assert.ok(calls.every(item => item.params.contextId === 7));
});

test('an untrusted context, a missing context or an unknown operation is ignored without any service call', async () => {
  let reached = 0;
  const service = { list: async () => { reached++; return {}; } };
  const untrusted = fixture({ trusted: false, service });
  await untrusted.binding.handle(call('r1', 'list', {}), untrusted.connection, { executionContextId: 3 });
  const trusted = fixture({ service });
  await trusted.binding.handle(call('r2', 'list', {}), trusted.connection, {});
  await trusted.binding.handle(call('r3', 'destroy-everything', {}), trusted.connection, { executionContextId: 3 });
  await trusted.binding.handle(call('r4', 'constructor', {}), trusted.connection, { executionContextId: 3 });
  assert.equal(reached, 0);
  assert.deepEqual(responses(untrusted.calls), []); assert.deepEqual(responses(trusted.calls), []);
});

test('malformed, oversized and badly identified payloads are dropped; validation and service errors come back as failures', async () => {
  const { binding, connection, calls } = fixture({ service: { forward: async () => { throw Error('对方正在回复'); } } });
  const params = { executionContextId: 1 };
  for (const payload of ['{', JSON.stringify([]), call('bad id!', 'list', {}), call('x'.repeat(81), 'list', {}), 'x'.repeat(17 * 1024), 42]) await binding.handle(payload, connection, params);
  assert.deepEqual(calls, []);
  await binding.handle(call('r1', 'forward', { id: 'nope', from: 'gpt' }), connection, params);
  await binding.handle(call('r2', 'forward', { id: ID, from: 'gpt' }), connection, params);
  assert.deepEqual(responses(calls).map(item => [item.id, item.ok, item.message]), [['r1', false, '讨论标识无效'], ['r2', false, '对方正在回复']]);
});

test('the page client posts to the bridge and resolves or rejects from the host response', async () => {
  const sent = []; const window = { [NATIVE_DISCUSSION_BINDING]: payload => sent.push(JSON.parse(payload)) };
  vm.runInNewContext(buildNativeDiscussionClientSource(), { window, setTimeout, clearTimeout, Date, JSON, Promise, Error, String });
  const client = window.__cccDiscussions;
  const ok = client.request('list', {}), bad = client.request('forward', { id: 'x' });
  assert.deepEqual(sent.map(item => item.operation), ['list', 'forward']);
  assert.equal(window.__codexControlConsoleResolveDiscussion({ id: sent[0].id, ok: true, result: { discussions: [] } }), true);
  window.__codexControlConsoleResolveDiscussion({ id: sent[1].id, ok: false, message: '被拒绝' });
  assert.deepEqual(await ok, { discussions: [] });
  await assert.rejects(bad, { message: '被拒绝' });
  assert.equal(window.__codexControlConsoleResolveDiscussion({ id: 'unknown', ok: true }), false);
  vm.runInNewContext(buildNativeDiscussionClientSource(), { window, setTimeout, clearTimeout, Date, JSON, Promise, Error, String });
  assert.equal(window.__cccDiscussions, client, 'installing again keeps the same client');
  const bare = { setTimeout, clearTimeout, Date, JSON, Promise, Error, String, window: {} };
  vm.runInNewContext(buildNativeDiscussionClientSource(), bare);
  await assert.rejects(bare.window.__cccDiscussions.request('list'), { message: '协作讨论桥不可用' });
});
