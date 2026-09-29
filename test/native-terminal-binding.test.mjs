import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeTerminalBinding, NATIVE_TERMINAL_BINDING } from '../src/native-terminal-binding.mjs';
const uuid = '12345678-1234-4234-8234-123456789abc';
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
async function harness() {
  let listener, detached = 0, received = [], allowed = true, listed = 0, closed, output, gate = null;
  const replies = [], stats = { originChecks: 0, deliveries: 0 };
  const single = 'globalThis.__cccTerminalNativeReceive?.(', many = 'for (const message of [';
  const connection = {
    onEvent(fn) { listener = fn; return () => { listener = null; }; },
    async send(method, params) {
      if (method !== 'Runtime.evaluate') return {};
      if (params.expression.startsWith('location.origin')) { stats.originChecks++; return { result: { value: allowed } }; }
      stats.deliveries++;
      const { expression } = params;
      const messages = expression.startsWith(single) ? [JSON.parse(expression.slice(single.length, -1))]
        : JSON.parse('[' + expression.slice(expression.indexOf(many) + many.length, expression.lastIndexOf(']) {')) + ']');
      for (const message of messages) replies.push({ contextId: params.contextId, message });
      if (gate) await gate;
      return {};
    }
  };
  const conversations = { async list() { listed++; return { conversations: [] }; }, async open() { return { runtimeSessionId: 'pty-a' }; } };
  const terminals = { connect(id, transport) { assert.equal(id, 'pty-a'); closed = transport.close; output = transport.send; transport.send({ type: 'ready', replay: '' }); return { detach() { detached++; }, receive(frame) { received.push(frame); } }; } };
  const dispose = await installNativeTerminalBinding(connection, conversations, terminals);
  const request = async (operation, input = {}, contextId = 1) => {
    listener?.({ method: 'Runtime.bindingCalled', params: { name: NATIVE_TERMINAL_BINDING, executionContextId: contextId, payload: JSON.stringify({ id: 'request-' + replies.length, operation, input }) } }); await settle();
  };
  return { request, replies, stats, hold() { let open; gate = new Promise(resolve => { open = resolve; }); return () => { gate = null; open(); }; }, dispose, deny() { allowed = false; }, listed: () => listed, detached: () => detached, received,
    event: value => listener?.(value), close: () => closed(4001, 'takeover'), output: frame => output(frame) };
}
test('native terminal rejects non-app contexts and unsupported metadata operations', async () => {
  const h = await harness(); h.deny(); await h.request('list'); assert.equal(h.listed(), 0); assert.equal(h.replies.length, 0); h.dispose();
  const valid = await harness(); await valid.request('list'); assert.equal(valid.listed(), 1);
  await valid.request('exec', { command: 'anything' }); assert.match(valid.replies.at(-1).message.error, /不支持/);
  await valid.request('list', { extra: true }); assert.equal(valid.listed(), 1); valid.dispose();
});
test('PTY stream ownership is bound to its execution context and detaches without killing', async () => {
  const h = await harness(); await h.request('attach', { id: uuid, stream: uuid });
  assert.equal(h.replies[0].message.frame.type, 'ready');
  await h.request('input', { stream: uuid, frame: { type: 'input', data: 'hello' } }, 2);
  assert.equal(h.received.length, 0); assert.match(h.replies.at(-1).message.error, /断开/);
  await h.request('input', { stream: uuid, frame: { type: 'input', data: 'hello' } }); assert.equal(h.received.length, 1);
  h.event({ method: 'Runtime.executionContextDestroyed', params: { executionContextId: 1 } }); assert.equal(h.detached(), 1); h.dispose();
});
test('attach followed immediately by detach leaves no stream and disposal prevents later operations', async () => {
  const h = await harness(); await Promise.all([h.request('attach', { id: uuid, stream: uuid }), h.request('detach', { stream: uuid })]);
  assert.equal(h.detached(), 1); h.dispose(); await h.request('list'); assert.equal(h.listed(), 0);
});


test('oversized native output detaches the writer and reports a bounded close', async () => {
  const h = await harness(); await h.request('attach', { id: uuid, stream: uuid });
  h.output({ type: 'data', data: 'x'.repeat(2 * 1024 * 1024) }); await settle();
  assert.equal(h.detached(), 1); assert.equal(h.replies.at(-1).message.close.code, 4002); h.dispose();
});

test('output queued behind a busy page arrives in order in one batched evaluate', async () => {
  const h = await harness(); await h.request('attach', { id: uuid, stream: uuid });
  const before = h.stats.deliveries, release = h.hold();
  h.output({ type: 'data', data: 'a' }); await settle();
  for (const data of ['b', 'c', 'd']) h.output({ type: 'data', data });
  release(); await settle();
  assert.deepEqual(h.replies.filter(reply => reply.message.frame?.type === 'data').map(reply => reply.message.frame.data), ['a', 'b', 'c', 'd']);
  assert.equal(h.stats.deliveries - before, 2, 'the three queued chunks share one evaluate');
  h.dispose();
});
test('the page origin is checked once per execution context and again after it is destroyed', async () => {
  const h = await harness();
  await h.request('list'); await h.request('list'); await h.request('list');
  assert.equal(h.stats.originChecks, 1);
  h.event({ method: 'Runtime.executionContextDestroyed', params: { executionContextId: 1 } });
  await h.request('list'); assert.equal(h.stats.originChecks, 2);
  h.event({ method: 'Runtime.executionContextsCleared', params: {} });
  h.deny(); await h.request('list'); assert.equal(h.listed(), 4, 'a denied context after clearing is not trusted from cache');
  h.dispose();
});
