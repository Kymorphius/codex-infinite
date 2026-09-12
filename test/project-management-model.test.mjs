import test from 'node:test';
import assert from 'node:assert/strict';
import { actionReason, filterProjects, moveTargets, pinTarget, projectAction, projectCatalog, projectIdentity,
  sectionIdentity, validateCatalogPayload } from '../public/features/projects/model.js';

const revision = 'a'.repeat(64);
function owner(id = 'mac', overrides = {}) {
  return { device: { id, name: id, kind: id === 'mac' ? 'local-codex' : 'remote-codex' }, status: 'connected',
    snapshot: { schemaVersion: 1, revision, capabilities: ['open', 'item-move'],
      projects: [
        { key: 'p1', name: 'Zeta', source: 'codex', sourceDirectories: ['/work/Zeta'], conversationKeys: [], childrenLoaded: true },
        { key: 'p2', name: 'Alpha', source: 'chatgpt', sourceDirectories: [], conversationKeys: [], childrenLoaded: false },
        { key: 'p3', name: 'Hidden catalog', source: 'codex', sourceDirectories: ['/work/excluded'], conversationKeys: [], childrenLoaded: true }
      ], sections: [
        { id: 'pinned', name: '置顶', kind: 'pinned', itemKeys: ['p2'] },
        { id: 'projects', name: '项目', kind: 'projects', itemKeys: [] },
        { id: 'custom', name: '工作', kind: 'custom', itemKeys: ['p1'] },
        { id: 'tasks', name: '任务', kind: 'tasks', itemKeys: [] }
      ] }, ...overrides };
}
const catalog = devices => projectCatalog(validateCatalogPayload({ schemaVersion: 1, devices }));

test('complete catalog includes empty and unassigned projects, and keeps matching native keys on different owners', () => {
  const result = catalog([owner(), owner('windows')]);
  assert.equal(result.projects.length, 6);
  assert.equal(new Set(result.projects.map(project => project.identity)).size, 6);
  assert.equal(result.projects[0].conversationCount, 0);
  assert.equal(result.projects[1].conversationCount, null);
  assert.equal(result.projects[2].section, null);
  assert.equal(result.sections.length, 6);
  assert.equal(result.projects[0].section.id, 'custom');
});

test('search covers case insensitive names and paths; source, owner and exact owner section filters compose', () => {
  const { projects } = catalog([owner(), owner('windows')]);
  assert.equal(filterProjects(projects, { query: ' /WORK/ZeTA ' }).length, 2);
  assert.equal(filterProjects(projects, { query: 'alpha', source: 'codex' }).length, 0);
  assert.deepEqual(filterProjects(projects, { device: 'windows', section: sectionIdentity('windows', 'custom') }).map(row => row.identity), [projectIdentity('windows', 'p1')]);
  assert.equal(filterProjects(projects, { device: 'mac', section: sectionIdentity('windows', 'custom') }).length, 0);
});

test('native order follows owner sections then unassigned catalog, name and pinned sorts are available', () => {
  const { projects } = catalog([owner()]);
  assert.deepEqual(filterProjects(projects).map(row => row.key), ['p2', 'p1', 'p3']);
  assert.deepEqual(filterProjects(projects, { sort: 'name' }).map(row => row.key), ['p2', 'p3', 'p1']);
  assert.equal(filterProjects(projects, { sort: 'pinned' })[0].key, 'p2');
});

test('actions preserve exact owner, native section/key and current revision', () => {
  const project = catalog([owner('windows')]).projects[0];
  assert.deepEqual(projectAction(project, 'open'), { action: 'open', deviceId: 'windows', itemKey: 'p1', sectionId: 'custom', expectedRevision: revision });
  assert.deepEqual(projectAction(project, 'item-move', 'pinned'), { action: 'item-move', deviceId: 'windows', itemKey: 'p1', sectionId: 'custom', expectedRevision: revision, targetSectionId: 'pinned' });
  assert.deepEqual(moveTargets(project).map(row => row.id), ['pinned', 'projects']);
  assert.equal(pinTarget(project).id, 'pinned');
  assert.equal(pinTarget(catalog([owner()]).projects[1]).id, 'projects');
  assert.throws(() => projectAction(project, 'item-move', 'tasks'), /目标分区不可用/);
  assert.throws(() => projectAction(project, 'item-move', 'custom'), /目标分区不可用/);
});

test('stale, offline, missing revision, unassigned and unadvertised operations are blocked', () => {
  const online = owner();
  online.snapshot.capabilities = ['open'];
  const project = catalog([online]).projects[0];
  assert.match(actionReason(project, 'item-move'), /暂未开放置顶和移动/);
  assert.throws(() => projectAction(project, 'item-move', 'pinned'), /暂未开放/);
  assert.equal(actionReason(project, 'open'), '');
  assert.match(actionReason({ ...project, revision: null }, 'open'), /版本/);
  assert.match(actionReason(catalog([owner('offline', { status: 'offline' })]).projects[0], 'open'), /缓存记录/);
  assert.match(actionReason(projectCatalog({ devices: [owner()] }, { stale: true }).projects[0], 'open'), /缓存记录/);
  assert.match(actionReason(catalog([owner()]).projects[2], 'open'), /未映射/);
});

test('loading owners are retained, and malformed connected catalogs cannot become empty success', () => {
  assert.equal(catalog([owner('loading', { status: 'loading', snapshot: null })]).devices.length, 1);
  assert.throws(() => validateCatalogPayload({ schemaVersion: 1, devices: [owner('bad', { snapshot: null })] }), /格式无效/);
  assert.throws(() => validateCatalogPayload({ schemaVersion: 1, devices: [{ ...owner(), snapshot: { projects: [], sections: [] } }] }), /格式无效/);
});
