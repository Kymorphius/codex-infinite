import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProjectSyncService } from '../src/project-sync-service.mjs';

function fixture() {
  const mutations = [];
  function adapter(deviceId) {
    const state = { path: `/${deviceId}`, branch: 'main', head: 'a'.repeat(40), clean: true, identitySupported: true, sharedProjectId: null };
    return { state, peer: { id: deviceId, name: deviceId },
      inspect: async () => ({ ...state }),
      catalog: async () => ({ projects: [{ ...state, name: deviceId }] }),
      associate: async ({ path, projectId, expected }) => {
        mutations.push(deviceId);
        if (state.sharedProjectId !== expected.sharedProjectId && state.sharedProjectId !== projectId) throw Error('changed identity');
        state.sharedProjectId = projectId; return { path, projectId };
      },
      dissociate: async ({ path, projectId }) => {
        if (state.sharedProjectId !== null && projectId !== state.sharedProjectId) throw Error('changed identity');
        state.sharedProjectId = null; return { path, projectId: null };
      }
    };
  }
  const a = adapter('a'), b = adapter('b'), c = adapter('c');
  const make = (local, peers) => new ProjectSyncService({ localAdapter: local, localDevice: local.peer, peers });
  const service = make(a, [b, c]);
  const pair = (source = a, target = b) => ({ source: { deviceId: source.peer.id, path: source.state.path }, target: { deviceId: target.peer.id, path: target.state.path } });
  return { a, b, c, service, make, pair, mutations };
}

test('link is confirmed on both owners and a third coordinator reuses the same identity', async () => {
  const f = fixture(), preview = await f.service.preflight(f.pair());
  const result = await f.service.link({ token: preview.token });
  assert.equal(result.linked, true); assert.equal(f.a.state.sharedProjectId, f.b.state.sharedProjectId);
  assert.deepEqual(f.mutations, ['a', 'b']);
  await assert.rejects(f.service.execute({ token: preview.token }), /已使用/);
  const fromC = f.make(f.c, [f.a, f.b]);
  const again = await fromC.link({ token: (await fromC.preflight(f.pair(f.b, f.c))).token });
  assert.equal(again.projectId, result.projectId);
  assert.equal(f.c.state.sharedProjectId, result.projectId);
  const list = await fromC.catalog();
  assert.equal(list.devices.every(owner => owner.projects[0].sharedProjectId === result.projectId), true);
});

test('lost second write leaves visible partial state and manual new preflight completes it', async () => {
  const f = fixture(), associate = f.b.associate;
  f.b.associate = async () => { throw Error('offline'); };
  await assert.rejects(f.service.link({ token: (await f.service.preflight(f.pair())).token }), /可能只保存了一端/);
  const id = f.a.state.sharedProjectId;
  assert.ok(id); assert.equal(f.b.state.sharedProjectId, null); assert.deepEqual(f.mutations, ['a']);
  f.b.associate = associate;
  assert.equal((await f.service.link({ token: (await f.service.preflight(f.pair())).token })).projectId, id);
});

test('different project identities and identity changes invalidate link and code execution', async () => {
  const f = fixture(); f.a.state.sharedProjectId = randomUUID(); f.b.state.sharedProjectId = randomUUID();
  await assert.rejects(f.service.preflight(f.pair()), /不同的共享项目/);
  f.b.state.sharedProjectId = null;
  for (const action of ['link', 'execute']) {
    const preview = await f.service.preflight(f.pair());
    f.a.state.sharedProjectId = randomUUID();
    await assert.rejects(f.service[action]({ token: preview.token }), /关联已变化/);
  }
  assert.equal(f.mutations.length, 0);
});

test('changed checkout and old nodes cannot link, and misleading readback cannot report success', async () => {
  const f = fixture();
  let preview = await f.service.preflight(f.pair()); f.b.state.head = 'b'.repeat(40);
  await assert.rejects(f.service.link({ token: preview.token }), /版本已变化/);
  f.b.state.head = f.a.state.head; delete f.b.state.identitySupported; delete f.b.state.sharedProjectId;
  preview = await f.service.preflight(f.pair());
  await assert.rejects(f.service.link({ token: preview.token }), /升级/);
  f.b.state.identitySupported = true; f.b.state.sharedProjectId = null;
  f.b.associate = async ({ path, projectId }) => ({ path, projectId });
  await assert.rejects(f.service.link({ token: (await f.service.preflight(f.pair())).token }), /未完整确认/);
});

test('unlink changes one owner only and refuses stale identities', async () => {
  const f = fixture(), result = await f.service.link({ token: (await f.service.preflight(f.pair())).token });
  await assert.rejects(f.service.unlink({ project: f.pair().target, projectId: randomUUID() }), /changed identity/);
  assert.equal((await f.service.unlink({ project: f.pair().target, projectId: result.projectId })).unlinked, true);
  assert.equal(f.a.state.sharedProjectId, result.projectId); assert.equal(f.b.state.sharedProjectId, null);
});
