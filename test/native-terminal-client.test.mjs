import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTerminalClient } from '../src/native-terminal-client.mjs';

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function page() {
  const calls = [], window = {};
  let n = 0;
  const context = vm.createContext({ window, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    TextEncoder, setTimeout, clearTimeout, queueMicrotask, JSON, Promise, Error, Map });
  window.codexControlConsoleTerminal = payload => calls.push(JSON.parse(payload));
  vm.runInContext(`(${installNativeTerminalClient.toString()})()`, context);
  const reply = (call, result = { ok: true }) => window.__cccTerminalNativeReceive({ id: call.id, result });
  return { window, calls, reply };
}

test('input queued behind an in-flight request merges into one ordered frame', async () => {
  const { window, calls, reply } = page();
  const Socket = window.__cccTerminalNative.socketClass('conversation');
  const socket = new Socket(); await settle();
  reply(calls.shift()); await settle(); // attach
  window.__cccTerminalNativeReceive({ stream: socket.stream, frame: { type: 'ready' } });
  socket.send(JSON.stringify({ type: 'input', data: '\x1b[<64;10;5M' }));
  assert.equal(calls.length, 1, 'the first input is sent at once');
  socket.send(JSON.stringify({ type: 'input', data: '\x1b[<64;10;5M' }));
  socket.send(JSON.stringify({ type: 'input', data: '\x1b[<64;10;5M' }));
  socket.send(JSON.stringify({ type: 'resize', cols: 80, rows: 24 }));
  socket.send(JSON.stringify({ type: 'input', data: 'x' }));
  assert.equal(calls.length, 1, 'later frames wait for the in-flight request');
  reply(calls[0]); await settle();
  assert.deepEqual(calls[1].input.frame, { type: 'input', data: '\x1b[<64;10;5M\x1b[<64;10;5M' });
  reply(calls[1]); await settle();
  assert.deepEqual(calls[2].input.frame, { type: 'resize', cols: 80, rows: 24 }, 'a non-input frame keeps its place');
  reply(calls[2]); await settle();
  assert.deepEqual(calls[3].input.frame, { type: 'input', data: 'x' });
  reply(calls[3]); await settle();
  assert.equal(socket.bufferedAmount, 0);
});
