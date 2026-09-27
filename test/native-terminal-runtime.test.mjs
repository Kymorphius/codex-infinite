import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { prepareNativeTerminalRuntime } from '../src/native-terminal-runtime.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('packaged native terminal bootstraps without network, exports xterm and correlates host requests', async () => {
  const sent = [], context = vm.createContext({ console, crypto: webcrypto, setTimeout, clearTimeout, queueMicrotask, TextEncoder, document: {}, navigator: { userAgent: "Chrome", platform: "MacIntel", language: "zh-CN" } });
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context);
  context.codexControlConsoleTerminal = payload => sent.push(JSON.parse(payload));
  let installs = 0;
  const connection = { async evaluate(source) { if (source.length > 1000) installs++; return vm.runInContext(source, context); } };
  await prepareNativeTerminalRuntime(connection); await prepareNativeTerminalRuntime(connection);
  assert.equal(installs, 1); assert.equal(typeof context.Terminal, 'function'); assert.equal(typeof context.FitAddon.FitAddon, 'function');
  assert.equal(typeof context.__cccOpenNativeTerminal, 'function');
  const promise = context.__cccTerminalNative.request('list');
  const message = sent.at(-1); context.__cccTerminalNativeReceive({ id: 'wrong', result: {} });
  context.__cccTerminalNativeReceive({ id: message.id, result: { conversations: [] } });
  assert.deepEqual(await promise, { conversations: [] });
  const Socket = context.__cccTerminalNative.socketClass('conversation'); const socket = new Socket(); let replay;
  socket.onmessage = event => { replay = JSON.parse(event.data); }; await settle();
  const attach = sent.at(-1); assert.equal(attach.operation, 'attach');
  context.__cccTerminalNativeReceive({ stream: attach.input.stream, frame: { type: 'ready', replay: 'hello' } });
  context.__cccTerminalNativeReceive({ id: attach.id, result: { ok: true } });
  assert.equal(socket.readyState, 1); assert.equal(replay.replay, 'hello'); socket.close();
  const detach = sent.at(-1); assert.equal(detach.operation, 'detach'); context.__cccTerminalNativeReceive({ id: detach.id, result: { ok: true } });
  context.__cccTerminalNative.dispose();
});
