import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeProjectSearchCatalog } from '../src/federated-project-search.mjs';
import { filterProjectNames } from '../src/project-search.mjs';

const project = { key: 'same', name: 'Tokens', sourceDirectory: 'D:\\Tokens', conversations: [{ id: 'remote-thread', title: '远端会话' }], hiddenConversationCount: 3 };
test('unified search preserves local/device order and isolates equal project IDs across hosts', () => {
  const local = { projects: [{ id: 'same', name: 'Tokens', sourceDirectory: '/local/Tokens', tasks: [] }], stale: false };
  const snapshot = mergeProjectSearchCatalog(local, [
    { id: 'win', name: 'Windows', status: 'connected', projects: [project, project] },
    { id: 'mac', name: 'Mac', status: 'offline', projects: [{ ...project, sourceDirectory: '/remote/Tokens' }] }
  ]);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.projects.length, 3);
  assert.equal(new Set(snapshot.projects.map(project => project.searchKey)).size, 3);
  assert.deepEqual(snapshot.projects.map(project => project.device.name), ['本机', 'Windows', 'Mac']);
  assert.deepEqual(snapshot.projects.map(project => project.sourceDirectory), ['/local/Tokens', 'D:\\Tokens', '/remote/Tokens']);
  assert.equal(snapshot.projects[2].device.status, 'offline');
  assert.equal(snapshot.projects[1].hiddenConversationCount, 3);
  assert.equal(filterProjectNames(snapshot.projects, 'ＴＯＫ').length, 3);
  assert.equal(local.projects[0].device, undefined);
});
test('remote results survive an unavailable local catalog and use normalized remote records only', () => {
  const snapshot = mergeProjectSearchCatalog(undefined, [{ id: 'win', name: 'Windows', projects: [{ ...project, secret: 'never-expose' }] }]);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].secret, undefined);
  assert.equal(snapshot.projects[0].device.status, 'offline');
  assert.deepEqual(snapshot.projects[0].sourceDirectories, ['D:\\Tokens']);
});
