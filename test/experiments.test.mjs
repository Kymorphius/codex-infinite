import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildExperimentReadScript, NativeExperimentAdapter } from '../src/native-experiment-adapter.mjs';
import { normalizeExperimentSnapshot } from '../src/experiment-contract.mjs';
import { ExperimentService } from '../src/experiment-service.mjs';
import { createExperimentsHttpHandler } from '../src/experiments-http.mjs';
import { sshExperimentsArguments } from '../src/ssh-peer-commands.mjs';

const item = { name: 'demo', enabled: true, stage: 'beta' };
const snapshot = { native: { status: 'connected', items: [item] }, console: { status: 'connected', items: [] } };
function nativeContext(replies) {
  const listeners = new Set(), requests = [];
  const window = { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn),
    __codexControlConsoleUnifiedSidebar: { enabled: false },
    electronBridge: { sendMessageFromView(message) {
      requests.push(message);
      queueMicrotask(() => { for (const fn of listeners) fn({ data: { type: 'mcp-response', hostId: 'local', message: { id: message.request.id, ...replies.shift() } } }); });
    } } };
  return { context: { window, crypto, setTimeout, clearTimeout }, requests, listeners };
}
test('reads all native pages without enabling features and observes actual extension enabled state', async () => {
  const fixture = nativeContext([{ result: { data: [item], nextCursor: 'next' } }, { result: { data: [{ ...item, name: 'other' }], nextCursor: null } }]);
  const result = await vm.runInNewContext(buildExperimentReadScript(), fixture.context);
  assert.equal(result.native.items.length, 2);
  assert.equal(result.console.items.find(x => x.name === 'unified-sidebar').enabled, false);
  assert.equal(fixture.requests[1].request.params.cursor, 'next');
  assert.ok(fixture.requests.every(x => x.request.method === 'experimentalFeature/list'));
  assert.equal(fixture.listeners.size, 0);
});
test('repeated cursor rejects partial success and preserves console inventory', async () => {
  const fixture = nativeContext([{ result: { data: [item], nextCursor: 'same' } }, { result: { data: [item], nextCursor: 'same' } }]);
  const result = await vm.runInNewContext(buildExperimentReadScript(), fixture.context);
  assert.equal(result.native.status, 'unavailable');
  assert.equal(result.console.status, 'connected');
  assert.equal(fixture.listeners.size, 0);
});
test('projection drops unknown data and never fabricates availability', () => {
  const result = normalizeExperimentSnapshot({ ...snapshot, token: 'secret', native: { status: 'connected', items: [{ ...item, secret: 'secret' }] } });
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(normalizeExperimentSnapshot(null).native.status, 'unavailable');
  assert.throws(() => normalizeExperimentSnapshot({ native: { status: 'connected', items: [{ name: 'bad', enabled: 'true' }] } }));
});
test('native adapter excludes stable features and closes its connection', async () => {
  let closed = false;
  const adapter = new NativeExperimentAdapter({ discover: async () => [], choose: () => ({ webSocketDebuggerUrl: 'mock' }),
    connectionFactory: () => ({ connect: async () => {}, evaluate: async () => ({ ...snapshot, native: { status: 'connected', items: [item, { ...item, name: 'stable', stage: 'stable' }] } }), close: async () => { closed = true; } }) });
  const result = await adapter.read();
  assert.equal(result.native.items.length, 1);
  assert.equal(closed, true);
});
test('offline peer cannot hide a successful local result', async () => {
  const service = new ExperimentService({ localAdapter: { read: async () => snapshot }, localDevice: { id: 'local', name: 'Local' },
    peers: [{ id: 'offline', name: 'Offline', transports: [] }] });
  const result = await service.read();
  assert.equal(result.devices[0].snapshot.native.status, 'connected');
  assert.equal(result.devices[1].snapshot.native.status, 'unavailable');
});
test('HTTP boundary is read-only and local route never aggregates peers', async () => {
  let local = 0;
  const handle = createExperimentsHttpHandler({ experimentService: { readLocal: async () => { local++; return snapshot; }, read: async () => { throw Error('must not aggregate'); } } });
  const response = { writeHead(code) { this.code = code; }, end() {} };
  assert.equal(await handle({ method: 'POST' }, response, new URL('http://localhost/api/experiments')), true);
  assert.equal(response.code, 405); assert.equal(local, 0);
  await handle({ method: 'GET' }, response, new URL('http://localhost/api/node/experiments'));
  assert.equal(response.code, 200); assert.equal(local, 1);
});
test('peer reads fixed local endpoint through platform-specific SSH transport', () => {
  const transport = { type: 'ssh', host: 'host', user: 'user', port: 22, dashboardPort: 47831 };
  const posix = sshExperimentsArguments(transport);
  assert.ok(posix.includes('StrictHostKeyChecking=yes'));
  assert.equal(posix.at(-1), 'http://127.0.0.1:47831/api/node/experiments');
  const windows = sshExperimentsArguments(transport, { remotePlatform: 'windows' });
  assert.match(Buffer.from(windows.at(-1), 'base64').toString('utf16le'), /api\/node\/experiments/);
});
