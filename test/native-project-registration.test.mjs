import test from 'node:test';
import assert from 'node:assert/strict';
import { findNativeProjectHost, NativeProjectRegistration } from '../src/native-project-registration.mjs';

test('native host discovery requires a unique supported exported getter', () => {
  const getter = () => { const message = 'Project operations are not supported by this host'; return { createProjectForRoot() {}, message }; };
  assert.equal(typeof findNativeProjectHost({ getter }).createProjectForRoot, 'function');
  assert.throws(() => findNativeProjectHost({}), /无法确认/);
  assert.throws(() => findNativeProjectHost({ a: getter, b: getter }), /无法确认/);
});

test('registration requires both native acknowledgement and independent native registry readback; closes connection', async () => {
  let closes = 0;
  const adapter = new NativeProjectRegistration({ cdpOrigin: 'unused', discover: async () => [], choose: () => ({ webSocketDebuggerUrl: 'unused' }),
    connectionFactory: () => ({ connect: async () => {}, close: async () => { closes++; }, evaluate: async script => script.includes('getLocalProjects') ? [{ id: 'native', name: 'Project', roots: ['/project'] }] : ({ id: 'native', roots: ['/project'] }) }),
    sidebar: { read: async () => ({ projects: [{ source: 'codex', sourceDirectories: ['/project'] }] }) } });
  assert.deepEqual(await adapter.register({ path: '/project', name: 'Project' }), { projectId: 'native' }); assert.equal(closes, 2);
  adapter.connectionFactory = () => ({ connect: async () => {}, close: async () => { closes++; }, evaluate: async () => null });
  await assert.rejects(adapter.register({ path: '/project', name: 'Project' }), /尚未确认/); assert.equal(closes, 3);
});

test('native module lookup survives evicted timing entries using only the native entry source', async () => {
  const { loadNativeProjectHost } = await import('../src/native-project-registration.mjs');
  const names = ['performance', 'location', 'document', 'fetch'];
  const original = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const set = (name, value) => Object.defineProperty(globalThis, name, { configurable: true, value });
  try {
    set('performance', { getEntriesByType: () => [] }); set('location', { href: 'app://-/index.html' });
    set('document', { querySelectorAll: () => [{ src: 'app://-/assets/index-hash.js' }] });
    set('fetch', async url => { assert.equal(url, 'app://-/assets/index-hash.js'); return { ok: true, text: async () => 'import("./app-initial-hash.js")' }; });
    const result = await loadNativeProjectHost(value => value, async url => { assert.equal(url, 'app://-/assets/app-initial-hash.js'); return 'host'; });
    assert.equal(result, 'host');
    set('document', { querySelectorAll: () => [{ src: 'https://untrusted.invalid/assets/index-hash.js' }] });
    await assert.rejects(loadNativeProjectHost(value => value), /尚未就绪/);
  } finally { for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
});
