import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationContinuationService } from '../src/conversation-continuation-service.mjs';
const id = 'aaaaaaaa-1111-4111-8111-111111111111', op = 'bbbbbbbb-1111-4111-8111-111111111111', dest = 'cccccccc-1111-4111-8111-111111111111';
function fixture() {
  let time = 0;
  const snapshot = root => ({ path: root, clean: true, head: 'a'.repeat(40), branch: 'main', identitySupported: true, sharedProjectId: id });
  const source = snapshot('/source'), target = snapshot('/target'), calls = [];
  const packet = { threadId: id, sha256: 'b'.repeat(64), bytes: 123, title: 'Continue' };
  const verified = { verified: true, operationId: op, targetThreadId: dest, sourceThreadId: id, path: '/target', title: 'Continue', note: 'next step' };
  const a = { inspect: async () => ({ ...source }), conversationExport: async () => ({ ...packet }), conversationList: async () => ({ conversations: [{ threadId: id, title: 'Continue', status: 'completed', eligible: true }] }) };
  const b = { peer: { id: 'b', name: 'B' }, inspect: async () => ({ ...target }), conversationPrepare: async input => { calls.push(['prepare', input]); return { operationId: op, path: '/target' }; }, conversationApply: async input => { calls.push(['apply', input]); return { ...verified }; }, conversationResume: async input => { calls.push(['resume', input]); return { ...verified }; } };
  const service = new ConversationContinuationService({ localAdapter: a, localDevice: { id: 'a', name: 'A' }, peers: [b], now: () => time, ttlMs: 1000 });
  const input = { source: { deviceId: 'a', path: '/source' }, target: { deviceId: 'b', path: '/target' }, threadId: id, note: 'next step' };
  return { service, input, source, target, packet, a, b, calls, setTime: n => { time = n; } };
}
test('copies only matching associated code, hides history from preview and independently validates destination ID', async () => {
  const f = fixture();
  const preview = await f.service.conversationPreflight(f.input);
  assert.equal(preview.operationId, op); assert.equal(preview.thread.threadId, id);
  assert.equal(JSON.stringify(preview).includes('base64'), false);
  assert.equal(f.calls[0][1].note, 'next step');
  const result = await f.service.conversationExecute({ token: preview.token });
  assert.equal(result.verified, true); assert.equal(result.targetThreadId, dest);
  assert.deepEqual(result.target, { deviceId: 'b', path: '/target' });
  await assert.rejects(f.service.conversationExecute({ token: preview.token }), error => /已过期或使用/.test(error.message) && error.details?.applyStarted !== false);
});
test('unassociated, mismatched code, same-device and oversized notes reject before destination writes', async () => {
  for (const mode of ['identity', 'head', 'device', 'note']) {
    const f = fixture();
    if (mode === 'identity') f.target.sharedProjectId = null;
    if (mode === 'head') f.target.head = 'c'.repeat(40);
    if (mode === 'device') f.input.target.deviceId = 'a';
    if (mode === 'note') f.input.note = 'x'.repeat(2001);
    await assert.rejects(f.service.conversationPreflight(f.input)); assert.equal(f.calls.length, 0);
  }
});
test('changed source history, changed association and expiry consume permit before native apply', async () => {
  for (const mode of ['history', 'identity', 'expiry']) {
    const f = fixture(), preview = await f.service.conversationPreflight(f.input);
    if (mode === 'history') f.packet.sha256 = 'c'.repeat(64);
    if (mode === 'identity') f.source.sharedProjectId = op;
    if (mode === 'expiry') f.setTime(1001);
    await assert.rejects(f.service.conversationExecute({ token: preview.token }), error => error.details?.applyStarted === false);
    assert.equal(f.calls.some(([action]) => action === 'apply'), false);
    await assert.rejects(f.service.conversationExecute({ token: preview.token }), /已过期或使用/);
  }
});
test('unknown target result preserves explicit recovery ID and resumes only selected device', async () => {
  const f = fixture(); f.b.conversationApply = async () => ({ verified: false, operationId: op, message: 'native readback unknown' });
  const p = await f.service.conversationPreflight(f.input), r = await f.service.conversationExecute({ token: p.token });
  assert.equal(r.verified, false); assert.equal(r.operationId, op);
  const resumed = await f.service.conversationResume({ deviceId: 'b', operationId: op });
  assert.equal(resumed.targetThreadId, dest); assert.deepEqual(f.calls.at(-1), ['resume', { operationId: op }]);
});
test('source ID reuse and wrong native acknowledgement fail closed', async () => {
  const f = fixture(); f.b.conversationApply = async () => ({ verified: true, operationId: op, sourceThreadId: id, targetThreadId: id, path: '/target' });
  const p = await f.service.conversationPreflight(f.input);
  await assert.rejects(f.service.conversationExecute({ token: p.token }), /独立读回/);
});

test('destination dispatch failures cannot be advertised as safely unstarted', async () => {
  const f = fixture(); f.b.conversationApply = async () => { throw Object.assign(new Error('timeout'), { details: { applyStarted: false } }); };
  const p = await f.service.conversationPreflight(f.input);
  await assert.rejects(f.service.conversationExecute({ token: p.token }), error => error.details?.applyStarted === true);
});
