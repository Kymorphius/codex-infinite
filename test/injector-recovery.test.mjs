import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexInjector } from '../src/injector.mjs';
for (const message of ['CDP command timed out: Runtime.addBinding', 'CDP websocket closed', 'Provider unavailable']) {
  test(`enhancement recovery handles ${message}`, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => [{ id: 'owner', type: 'page', url: 'app://-/index.html', title: 'ChatGPT', webSocketDebuggerUrl: 'ws://127.0.0.1:9231/devtools/page/owner' }] });
    let closed = 0, detached = 0;
    const injector = new CodexInjector({ cdpOrigin: 'http://127.0.0.1:9231', logger: { warn() {} } });
    injector.targetId = 'owner';
    const connection = { send: async () => { throw Error(message); }, close: async () => { closed++; } };
    injector.connection = connection; injector.removeContextBindingListener = () => { detached++; };
    try { await injector.sync(); } finally { globalThis.fetch = originalFetch; }
    const transport = message.startsWith('CDP ');
    assert.equal(closed, transport ? 1 : 0); assert.equal(detached, transport ? 1 : 0);
    assert.equal(injector.connection, transport ? null : connection);
    assert.equal(injector.targetId, transport ? null : 'owner'); assert.equal(injector.syncing, false);
  });
}
