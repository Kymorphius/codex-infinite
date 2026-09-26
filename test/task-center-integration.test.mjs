import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createDashboardServer } from '../src/http-server.mjs';
import { resolveStaticAsset } from '../src/static-assets.mjs';
import { normalizeTaskCenterAction } from '../src/task-center-contract.mjs';

test('dashboard composition forwards task center and serves every browser module dependency', async t => {
  const config = { dashboardHost: '127.0.0.1', dashboardPort: 0, dashboardOrigin: 'http://127.0.0.1:0',
    cdpHost: '127.0.0.1', cdpPort: 9231, cdpOrigin: 'http://127.0.0.1:9231', profileDirectory: '/tmp/task-center-test' };
  const snapshot = { version: 1, localDeviceId: 'test', devices: [] };
  const adapter = { listTasks: async () => ({ tasks: [], projects: [] }) };
  const dashboard = createDashboardServer({ config, adapter, taskCenter: {
    service: { read: async () => snapshot }, owner: { read: async () => ({ version: 1, device: { id: 'test' }, items: [] }) }
  } });
  await dashboard.listen(); t.after(() => dashboard.close());
  const origin = `http://127.0.0.1:${dashboard.server.address().port}`;
  assert.deepEqual(await (await fetch(origin + '/api/task-center')).json(), snapshot);
  for (const name of ['index', 'model', 'controller', 'view', 'editor']) {
    const route = `/features/task-center/${name}.js`, response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type'), /javascript/);
    const source = await response.text();
    for (const [, specifier] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const dependency = new URL(specifier, origin + route).pathname;
      assert.ok(resolveStaticAsset(dependency), dependency);
      await fs.access(resolveStaticAsset(dependency).path);
    }
  }
  assert.equal((await fetch(origin + '/styles/task-center.css')).status, 200);
  assert.equal((await fetch(origin + '/features/task-center/not-registered.js')).status, 404);
});

test('default standalone local device identity is accepted without relaxing path contracts', () => {
  assert.equal(normalizeTaskCenterAction({ type: 'create', ownerDeviceId: 'local:My-Mac.local', id: 'temporary', requestId: 'request', text: '待办' }).ownerDeviceId, 'local:My-Mac.local');
  assert.throws(() => normalizeTaskCenterAction({ type: 'create', ownerDeviceId: '../node', id: 'temporary', requestId: 'request', text: '待办' }), /无效/);
});
