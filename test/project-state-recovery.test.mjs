import test from 'node:test';
import assert from 'node:assert/strict';
import { planMissingSidebarProjects } from '../src/project-state-recovery.mjs';
const p = { id: 'old', name: 'WorldManager', rootPaths: ['D:\\Dev\\WorldManager'] };
const server = { id: 'server', name: p.name, roots: [{ path: 'd:/dev/worldmanager' }] };
const fixture = () => ({ retainedProjects: { old: p }, retainedMappings: { old: 'server' }, serverProjects: [server] });
test('recovers only missing legacy identities validated against existing native projects', () => {
  const result = planMissingSidebarProjects(fixture());
  assert.deepEqual(result.projects.old, p);
  assert.equal(result.mappings.old, 'server');
  assert.equal(result.recovered.length, 1);
});
test('never resurrects deleted projects or maps unrelated roots', () => {
  assert.equal(planMissingSidebarProjects({ ...fixture(), serverProjects: [] }).recovered.length, 0);
  assert.equal(planMissingSidebarProjects({ ...fixture(), serverProjects: [{ ...server, roots: [{ path: 'D:/other' }] }] }).recovered.length, 0);
});
test('preserves active edits and conflicting mappings', () => {
  const active = { ...p, name: 'renamed' };
  assert.deepEqual(planMissingSidebarProjects({ ...fixture(), activeProjects: { old: active } }).projects.old, active);
  assert.equal(planMissingSidebarProjects({ ...fixture(), activeMappings: { old: 'different' } }).recovered.length, 0);
});
