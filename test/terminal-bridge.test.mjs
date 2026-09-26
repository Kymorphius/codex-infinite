import test from 'node:test';
import assert from 'node:assert/strict';
import { installTerminalBridge } from '../public/features/terminal/bridge.js';

const channel = '11111111-2222-3333-4444-555555555555';
test('bridge accepts only current parent native origin and matching channel', async () => {
  const calls = [], replies = []; let listener;
  const parent = { postMessage: (value, origin) => replies.push({ value, origin }) };
  const windowRef = { location: { href: `http://127.0.0.1/terminal-bridge.html?channel=${channel}` }, parent, addEventListener: (_, value) => { listener = value; } };
  assert.equal(installTerminalBridge({ windowRef, request: async (url, options) => { calls.push({ url, options }); return { conversations: [] }; } }), true);
  assert.equal(replies[0].value.type, 'codex-terminal-ready'); assert.equal(replies[0].origin, 'app://-');
  const event = { source: parent, origin: 'app://-', data: { type: 'codex-terminal-request', channel, id: 'one', operation: 'list', input: {} } };
  await listener({ ...event, origin: 'https://attacker.example' });
  await listener({ ...event, source: {} });
  await listener({ ...event, data: { ...event.data, channel: 'another' } });
  assert.equal(calls.length, 0);
  await listener(event); assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/terminal-conversations/list');
  assert.equal(replies[1].value.type, 'codex-terminal-response'); assert.equal(replies[1].value.id, 'one');
  await listener({ ...event, data: { ...event.data, operation: '../../anything' } });
  assert.equal(calls.length, 1); assert.match(replies.at(-1).value.error, /不支持/u);
});
