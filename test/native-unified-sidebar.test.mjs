import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeUnifiedSidebarInjectionScript } from '../src/native-unified-sidebar.mjs';
import { normalizeSidebarSnapshot, validateSidebarAction } from '../src/sidebar-contract.mjs';
import { SidebarFederationService } from '../src/sidebar-federation.mjs';
import { sidebarActionApplied } from '../src/native-sidebar-adapter.mjs';
const rev = 'a'.repeat(64);
function snapshot() { return normalizeSidebarSnapshot({ schemaVersion: 1, revision: rev, capabilities: ['item-move'],
  projects: [{ key: 'codex:project:p', id: 'p', source: 'codex', name: 'P', sourceDirectories: [], conversationKeys: [], childrenLoaded: true }], conversations: [],
  sections: [{ id: 'threads', name: 'Projects', kind: 'projects', itemKeys: ['codex:project:p'] }, { id: 'custom:x', name: '等待', kind: 'custom', itemKeys: [] }] }); }
test('source revision and actual source destinations are required', () => {
  const value = snapshot(), action = { action: 'item-move', expectedRevision: rev, sectionId: 'threads', itemKey: 'codex:project:p', targetSectionId: 'custom:x' };
  assert.equal(validateSidebarAction(value, action).targetSectionId, 'custom:x');
  assert.throws(() => validateSidebarAction(value, { ...action, expectedRevision: 'b'.repeat(64) }), /已变化/);
  assert.throws(() => validateSidebarAction(value, { ...action, targetSectionId: 'custom:other-machine' }), /不存在/);
  assert.throws(() => validateSidebarAction(value, { action: 'section-delete', sectionId: 'threads', expectedRevision: rev }), /系统分区/);
});
test('invalid native references are rejected and unknown fields are excluded', () => {
  const value = snapshot(); value.projects[0].secret = 'private'; assert.equal(normalizeSidebarSnapshot(value).projects[0].secret, undefined);
  value.sections[0].itemKeys.push('missing'); assert.throws(() => normalizeSidebarSnapshot(value), /引用无效/);
});
test('mutation verifies movement in source and removal from previous section', () => {
  const before = snapshot(), after = snapshot(), action = { action: 'item-move', targetSectionId: 'custom:x', itemKey: 'codex:project:p' };
  after.sections[1].itemKeys.push(action.itemKey); assert.equal(sidebarActionApplied(before, after, action), false);
  after.sections[0].itemKeys = []; assert.equal(sidebarActionApplied(before, after, action), true);
});
test('federation routes only to owner and retains unavailable source snapshot', async () => {
  let offline = false, calls = 0;
  const local = { read: async () => snapshot(), apply: async () => { throw Error('wrong owner'); } };
  const remote = { read: async () => { if (offline) throw Error('offline'); return snapshot(); }, apply: async () => { calls++; return { applied: true, snapshot: snapshot() }; } };
  const service = new SidebarFederationService({ localAdapter: local, localDevice: { id: 'local' }, peers: [{ peer: { id: 'remote' }, sidebar: remote }], cacheMs: 0 });
  await service.read(); await Promise.all(service.pending.values());
  await service.apply({ deviceId: 'remote', action: 'section-create', name: 'X', expectedRevision: rev }); assert.equal(calls, 1);
  offline = true; await service.read(); await Promise.all(service.pending.values());
  const cached = service.cache.get('remote'); assert.equal(cached.status, 'offline'); assert.equal(cached.snapshot.sections[1].name, '等待');
  await assert.rejects(service.apply({ deviceId: 'unknown' }), /未知/);
});
test('unified injection is parseable and has no local assignment system', () => {
  const source = buildNativeUnifiedSidebarInjectionScript('http://127.0.0.1:47831');
  assert.doesNotThrow(() => new Function(source)); assert.doesNotMatch(source, /assignments|\.assign\(/);
  assert.match(source, /expectedRevision: device.snapshot.revision/); assert.match(source, /event.source !== frame\?\.contentWindow/);
});

test('only explicit sidebar visibility may omit a membership revision', async () => {
  const { normalizeSidebarAction } = await import('../src/sidebar-contract.mjs');
  assert.deepEqual(normalizeSidebarAction({ action: 'sidebar-show', name: 'ignored', sectionId: 'ignored' }), { action: 'sidebar-show' });
  assert.throws(() => normalizeSidebarAction({ action: 'section-create', name: 'X' }), /缺少侧边栏版本/);
});
