import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexInjector } from '../src/injector.mjs';

test('extra bindings are registered on the target and routed to their handler', async () => {
  const handled = [], methods = [], warnings = [];
  const injector = new CodexInjector({
    cdpOrigin: 'http://127.0.0.1:9231', dashboardUrl: 'http://127.0.0.1:47831',
    extraBindings: [
      { name: 'extraOne', handle: async (payload, connection) => { handled.push([payload, Boolean(connection)]); } },
      { name: 'extraFails', handle: async () => { throw new Error('boom'); } }
    ],
    logger: { warn: (message) => warnings.push(message) }
  });
  const originalFetch = globalThis.fetch, originalSocket = globalThis.WebSocket;
  globalThis.fetch = async () => ({ ok: true, async json() { return [{ type: 'page', id: 'app', url: 'app://-/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:9231/app' }]; } });
  let socket;
  globalThis.WebSocket = class {
    constructor() { socket = this; this.readyState = 1; queueMicrotask(() => this.listeners.open?.({})); }
    addEventListener(name, listener) { this.listeners ||= {}; this.listeners[name] = listener; }
    send(payload) {
      const { id, method, params } = JSON.parse(payload);
      methods.push([method, params?.name]);
      const result = method === 'Runtime.evaluate' ? { result: { value: true } } : {};
      queueMicrotask(() => this.listeners.message?.({ data: JSON.stringify({ id, result }) }));
    }
    close() { this.readyState = 3; }
  };
  try {
    await injector.sync();
    const emit = (name, payload) => socket.listeners.message({ data: JSON.stringify({ method: 'Runtime.bindingCalled', params: { name, payload } }) });
    emit('extraOne', 'hello'); emit('extraFails', 'x'); emit('unrelated', 'y');
    await new Promise((resolve) => setImmediate(resolve));
  } finally { globalThis.fetch = originalFetch; globalThis.WebSocket = originalSocket; await injector.stop(); }
  assert.ok(methods.some(([method, name]) => method === 'Runtime.addBinding' && name === 'extraOne'));
  assert.deepEqual(handled, [['hello', true]]);
  assert.equal(warnings.filter((message) => /extraFails failed: boom/.test(message)).length, 1);
});
