import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { HermesKanbanBridge } from '../src/hermes-kanban-bridge.mjs';

function fixture() {
  const project = { id: 'p', name: 'Project', directories: [os.tmpdir()] };
  const session = { id: 'codex:s', title: 'Original', cwd: os.tmpdir(), shared_source: { projectId: 'p' } };
  let sent = false; const calls = [];
  const source = { list: async () => ({ projects: [project], sessions: [session] }),
    history: async () => ({ activeTurnId: null, messages: sent ? [{ id: 1, role: 'user', content: 'hello', source_turn_id: 'run' }] : [] }),
    send: async (id, text) => { calls.push([id, text]); sent = true; }, interrupt: async (id, turn) => calls.push([id, turn]) };
  const bridge = new HermesKanbanBridge({ source, device: { id: 'local', name: 'Local' }, pause: async () => {} });
  return { bridge, source, session, calls };
}
const target = { project_id: 'codex:p', device_id: 'local', conversation_id: 'codex:s', cwd: os.tmpdir(), text: 'hello' };
test('execution selection enforces original project, device, archive and cwd', async () => {
  const { bridge, session } = fixture();
  for (const change of [{ project_id: 'codex:other' }, { device_id: 'remote' }, { conversation_id: 'codex:other' }])
    await assert.rejects(bridge.resolve({ ...target, ...change }));
  await assert.rejects(bridge.send({ ...target, cwd: '/wrong' }));
  session.archived = true;
  await assert.rejects(bridge.resolve(target));
});
test('accepted task receipt binds the matching original user message and turn', async () => {
  const { bridge, calls } = fixture();
  assert.deepEqual(await bridge.send(target), { accepted: true, conversation_id: 'codex:s', turn_id: 'run', message_id: 1 });
  assert.deepEqual(calls, [['codex:s', 'hello']]);
});
test('busy owner and protected drafts are never retried or handed to another engine', async () => {
  const { bridge, source, calls } = fixture();
  source.history = async () => ({ activeTurnId: 'running', messages: [] });
  await assert.rejects(bridge.send(target)); assert.equal(calls.length, 0);
  source.history = async () => ({ activeTurnId: null, messages: [] });
  source.send = async () => { calls.push('attempt'); throw Error('draft conflict'); };
  await assert.rejects(bridge.send(target), /draft conflict/); assert.equal(calls.length, 1);
});
test('unknown send acknowledgement is surfaced without resubmission', async () => {
  const { bridge, source, calls } = fixture();
  source.history = async () => ({ activeTurnId: null, messages: [] });
  await assert.rejects(bridge.send(target), /不会自动重发/); assert.equal(calls.length, 1);
});
