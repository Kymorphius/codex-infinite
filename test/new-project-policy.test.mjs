import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveNewProjects, NEW_PROJECT_WEEK_MS } from '../src/new-project-policy.mjs';
const now = Date.parse('2026-09-05T10:00:00Z');
function entry(id, age = 1000, score = {}) {
  return { project: { id, name: id, createdAt: now - age }, score };
}

test('rank ten graduates, rank eleven stays; other classifications are untouched', () => {
  const ordered = Array.from({ length: 11 }, (_, i) => entry(String(i + 1)));
  ordered[10].project.section = '等待';
  const original = structuredClone(ordered);
  const result = deriveNewProjects(ordered, {}, now);
  assert.deepEqual(result.projects.map(p => p.id), ['11']);
  assert.equal(result.lifecycle['10'].reason, 'top-ten');
  assert.deepEqual(ordered, original);
});
test('one-week exact boundary expires, no-score projects cannot fill top-ten slots', () => {
  const result = deriveNewProjects([entry('before', NEW_PROJECT_WEEK_MS - 1, null), entry('exact', NEW_PROJECT_WEEK_MS, null)], {}, now);
  assert.deepEqual(result.projects.map(p => p.id), ['before']);
  assert.equal(result.lifecycle.exact.reason, 'one-week');
});
test('missing/future timestamps are not new; graduation survives rank decline and timestamp changes', () => {
  const first = deriveNewProjects([entry('graduate')], {}, now);
  const candidates = [entry('graduate', 0, null), entry('missing', 0, null), entry('future', -1000, null)];
  candidates[1].project.createdAt = null;
  const second = deriveNewProjects(candidates, JSON.parse(JSON.stringify(first.lifecycle)), now);
  assert.deepEqual(second.projects, []);
  assert.deepEqual(second.lifecycle, first.lifecycle);
});
