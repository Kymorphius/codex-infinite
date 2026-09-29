import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSyncRuntime } from '../src/project-sync-runtime.mjs';

function setup({ tasks = [], status = 'connected', statuses = new Map(), nativeError = false } = {}) {
  return createProjectSyncRuntime({
    config: { nodeDevice: { id: 'local', name: 'Local' }, peerActionKeyDirectory: '/unused' }, peers: [],
    nativeSidebarAdapter: { read: async () => ({ projects: [
      { source: 'codex', name: 'One', sourceDirectories: ['/one'] },
      { source: 'codex', name: 'Duplicate', sourceDirectories: ['/one'] },
      { source: 'codex', name: 'Multiple', sourceDirectories: ['/multi', '/roots'] },
      { source: 'chatgpt', name: 'Web project', sourceDirectories: ['/web'] }
    ] }) },
    nativeConversationAdapter: { readThreadStatuses: async options => {
      assert.equal(options.strict, true);
      if (nativeError) throw Error('native unavailable');
      return statuses;
    } },
    localAdapter: { listTasks: async () => ({ status, tasks }) }
  }).localProjectSyncAdapter;
}

test('only explicit single-root native Codex directories become sync choices', async () => {
  assert.deepEqual(await setup().projectProvider(), [{ path: '/one', name: 'One' }]);
});

test('failed index and native reads do not turn into an empty idle task list', async () => {
  await assert.rejects(setup({ status: 'error' }).taskProvider(), /无法确认本机任务/);
  await assert.rejects(setup({ nativeError: true }).taskProvider(), /原生运行状态/);
  await assert.rejects(setup({ statuses: null }).taskProvider(), /原生任务状态/);
});

test('live active tasks override stale completed metadata and unknown active paths block', async () => {
  const adapter = setup({ tasks: [{ id: 'known', cwd: '/one', status: 'completed' }], statuses: new Map([['known', 'active'], ['missing', 'active']]) });
  assert.deepEqual(await adapter.taskProvider(), [
    { id: 'known', cwd: '/one', status: 'active' }, { id: 'missing', status: 'active', cwd: null }
  ]);
});

test('new empty native projects remain selectable even when absent from sidebar rows', async () => {
  const runtime = createProjectSyncRuntime({ config: { nodeDevice: { id: 'local', name: 'Local' }, peerActionKeyDirectory: '/unused' }, peers: [],
    nativeProjectRegistrar: { catalog: async () => [{ id: 'empty', path: '/new-empty-project', name: 'New project' }] },
    nativeSidebarAdapter: { read: async () => { throw Error('empty project not rendered'); } }, nativeConversationAdapter: {}, localAdapter: {} });
  assert.deepEqual(await runtime.localProjectSyncAdapter.projectProvider(), [{ path: '/new-empty-project', name: 'New project' }]);
});
