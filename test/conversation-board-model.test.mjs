import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationCatalog, conversationIdentity, filterConversations, inferBoardState, inferWorkType, openAction, resolveOpenTarget, validateSidebarPayload } from '../public/features/conversations/model.js';

const revision = 'b'.repeat(64);
function owner(id = 'mac', overrides = {}) {
  return { device: { id, name: id, kind: id === 'mac' ? 'local-codex' : 'remote-codex' }, status: 'connected', snapshot: {
    schemaVersion: 1, revision, capabilities: ['open'], conversations: [
      { key: 'codex:thread:local:one', id: 'one', source: 'codex', title: '修复 Android 图片生成', cwd: '/work/app', status: 'active' },
      { key: 'chatgpt:conversation:two', id: 'two', source: 'chatgpt', title: '小说润色', cwd: null, status: 'unknown', route: '/c/two' },
      { key: 'codex:thread:local:three', id: 'three', source: 'codex', title: '完成报告', cwd: '/docs', status: 'completed' }
    ], projects: [{ key: 'project:p', name: '产品开发', sourceDirectories: ['/work'], conversationKeys: ['codex:thread:local:one'], childrenLoaded: true }], sections: [
      { id: 'custom:done', name: '已完成', kind: 'custom', itemKeys: ['codex:thread:local:three'] },
      { id: 'projects', name: '等待确认', kind: 'projects', itemKeys: ['project:p'] },
      { id: 'threads', name: '会话', kind: 'tasks', itemKeys: ['chatgpt:conversation:two'] }
    ] }, ...overrides };
}

test('catalog keeps owner identities and only direct sections override workflow state', () => {
  const sidebar = validateSidebarPayload({ schemaVersion: 1, devices: [owner(), owner('remote')] });
  const tasks = { tasks: [{ id: 'one', status: 'completed', updatedAt: '2026-09-12T10:00:00Z', device: { id: 'mac' } }] };
  const rows = conversationCatalog(sidebar, tasks);
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map(row => row.identity)).size, 6);
  const active = rows.find(row => row.deviceId === 'mac' && row.id === 'one');
  assert.equal(active.project.name, '产品开发'); assert.equal(active.state.id, 'accept');
  assert.equal(active.workType, '绘画');
  assert.equal(rows.find(row => row.deviceId === 'mac' && row.id === 'three').state.id, 'done');
  assert.equal(rows.find(row => row.deviceId === 'mac' && row.id === 'two').state.id, 'review');
});

test('pending approvals, error, active, completed and unknown follow state priority', () => {
  const base = { status: 'unknown' };
  assert.equal(inferBoardState(base, { activity: { approvals: [{}], turnState: 'active' } }).id, 'confirm');
  assert.equal(inferBoardState(base, { activity: { approvals: [], turnState: 'interrupted' } }).id, 'error');
  assert.equal(inferBoardState(base, { task: { status: 'active' } }).id, 'active');
  assert.equal(inferBoardState(base, { task: { status: 'completed' } }).id, 'accept');
  assert.equal(inferBoardState(base).id, 'review');
});

test('work type and composed filters stay conservative', () => {
  assert.equal(inferWorkType({ title: '设计插画', cwd: '' }), '绘画');
  assert.equal(inferWorkType({ title: '整理文献', cwd: '' }), '研究');
  assert.equal(inferWorkType({ title: '周末安排', cwd: '' }), '未分类');
  const rows = conversationCatalog({ devices: [owner()] }, { tasks: [] });
  assert.deepEqual(filterConversations(rows, { query: 'android', source: 'codex', device: 'mac', workType: '绘画' }).map(row => row.id), ['one']);
  assert.equal(filterConversations(rows, { query: '产品开发' }).length, 1);
});

test('open action carries exact native owner, key, section and revision', () => {
  const rows = conversationCatalog({ devices: [owner()] }, { tasks: [] });
  const row = rows.find(item => item.id === 'one');
  assert.deepEqual(openAction(row), { action: 'open', deviceId: 'mac', itemKey: 'codex:thread:local:one', sectionId: 'projects', expectedRevision: revision });
  assert.throws(() => openAction({ ...row, stale: true }), /缓存记录/);
  assert.throws(() => openAction({ ...row, capabilities: [] }), /暂不支持/);
  assert.throws(() => openAction({ ...row, revision: null }), /有效版本/);
});

test('open target is rebuilt from the latest sidebar revision', () => {
  const identity = conversationIdentity('mac', 'codex:thread:local:one');
  const latestRevision = 'c'.repeat(64);
  const latestOwner = owner('mac'); latestOwner.snapshot.revision = latestRevision;
  const { item, input } = resolveOpenTarget(identity, { schemaVersion: 1, devices: [latestOwner] });
  assert.equal(item.revision, latestRevision);
  assert.equal(input.expectedRevision, latestRevision);
  assert.throws(() => resolveOpenTarget(conversationIdentity('mac', 'missing'), { schemaVersion: 1, devices: [latestOwner] }), /最新侧栏/);
});

test('malformed connected catalog is rejected', () => {
  assert.throws(() => validateSidebarPayload({ schemaVersion: 1, devices: [{ ...owner(), snapshot: null }] }), /格式无效/);
  assert.throws(() => validateSidebarPayload({ schemaVersion: 2, devices: [] }), /格式无效/);
  assert.equal(conversationIdentity('mac', 'same'), '["mac","same"]');
});
