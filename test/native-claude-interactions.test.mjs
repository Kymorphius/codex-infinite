import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeClaudeInteractionBinding } from '../src/native-claude-interaction-binding.mjs';
import { createRouterInteractionClient } from '../src/router-interaction-client.mjs';

const threadId = '00000000-0000-0000-0000-000000000001';
test('native binding requires trusted current thread and never emits credentials', async () => {
  const calls = [], responses = []; let trusted = false;
  const binding = createNativeClaudeInteractionBinding({ request: async input => { calls.push(input); return { requests: [] }; } });
  const connection = { send: async (_, args) => {
    responses.push(args); return { result: { value: trusted } };
  } };
  const payload = JSON.stringify({ id: 'r1', operation: 'read', threadId });
  await binding.handle(payload, connection, { executionContextId: 1 }); assert.equal(calls.length, 0);
  trusted = true;
  await binding.handle(payload, connection, {}); assert.equal(calls.length, 0);
  await binding.handle(payload, connection, { executionContextId: 1 });
  assert.deepEqual(calls, [{ threadId }]);
  assert.match(responses[0].expression, /location.origin === 'app:\/\/-'/);
  assert.match(responses[0].expression, /window === window.top/);
  assert.match(responses[0].expression, new RegExp(threadId));
  new vm.Script(binding.source);
});

test('backend client keeps caller secret on loopback, refuses redirects and sanitizes transport errors', async () => {
  const secret = 'x'.repeat(40); const calls = [];
  const client = createRouterInteractionClient({ origin: 'http://127.0.0.1:4202', callerSecretPath: 'unused', readFile: async () => secret,
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => JSON.stringify(options.method === 'GET' ? { requests: [] } : { accepted: true }) }; } });
  assert.deepEqual(await client.request({ threadId }), { requests: [] });
  await client.request({ threadId, answer: { id: 'pending', decision: 'deny' } });
  assert.equal(calls[0].url.hostname, '127.0.0.1'); assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].url.searchParams.get('threadId'), threadId);
  assert.equal(JSON.parse(calls[1].options.body).threadId, threadId);
  await assert.rejects(client.request({ threadId: '../wrong' }));
  const broken = createRouterInteractionClient({ origin: 'http://127.0.0.1:4202', callerSecretPath: 'unused', readFile: async () => secret,
    fetchImpl: async () => { throw Error(secret); } });
  await assert.rejects(broken.request({ threadId }), error => !error.message.includes(secret));
});
