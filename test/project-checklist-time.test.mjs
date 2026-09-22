import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { checklistTimeMetadata } from '../src/project-checklist-time.mjs';

const initial = '2026-09-01T02:03:04.005Z', later = '2026-09-22T03:04:05.006Z';

test('checklist time metadata prioritizes immutable creation time and normalizes ISO timezones', () => {
  assert.deepEqual(checklistTimeMetadata({ createdAt: initial, updatedAt: later, heldAt: Date.parse(later) }), { createdAt: initial, createdAtEstimated: false });
  assert.deepEqual(checklistTimeMetadata({ createdAt: initial, createdAtEstimated: true }), { createdAt: initial, createdAtEstimated: true });
  assert.deepEqual(checklistTimeMetadata({ createdAt: '2026-09-01T10:03:04.005+08:00' }), { createdAt: initial, createdAtEstimated: false });
  assert.deepEqual(checklistTimeMetadata({ createdAt: '2026-09-01T02:03:04Z' }), { createdAt: '2026-09-01T02:03:04.000Z', createdAtEstimated: false });
});

test('legacy held times are precise while last updated times are explicitly estimated', () => {
  assert.deepEqual(checklistTimeMetadata({ heldAt: Date.parse(initial), updatedAt: later }), { createdAt: initial, createdAtEstimated: false });
  assert.deepEqual(checklistTimeMetadata({ heldAt: 0 }), { createdAt: '1970-01-01T00:00:00.000Z', createdAtEstimated: false });
  assert.deepEqual(checklistTimeMetadata({ heldAt: NaN, updatedAt: later }), { createdAt: later, createdAtEstimated: true });
  assert.deepEqual(checklistTimeMetadata({ updatedAt: initial }), { createdAt: initial, createdAtEstimated: true });
});

test('known unknown and invalid times do not acquire a fabricated creation time', () => {
  const unknown = { createdAt: null, createdAtEstimated: false };
  assert.deepEqual(checklistTimeMetadata({ createdAt: null, createdAtEstimated: true, updatedAt: later, heldAt: Date.parse(later) }), unknown);
  for (const createdAt of ['', 'today', '2026-02-30T12:00:00.000Z', '2026-01-01T24:00:00.000Z', 123, undefined]) {
    assert.deepEqual(checklistTimeMetadata({ createdAt, updatedAt: later }), unknown);
  }
  for (const item of [null, undefined, {}, { updatedAt: 'invalid' }, { heldAt: Infinity }, { heldAt: 8.65e15 }]) assert.deepEqual(checklistTimeMetadata(item), unknown);
});

test('checklist time normalization can run independently in the injected browser', () => {
  const item = { updatedAt: initial }, before = { ...item };
  const result = vm.runInNewContext(`(${checklistTimeMetadata.toString()})(${JSON.stringify(item)})`);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { createdAt: initial, createdAtEstimated: true });
  assert.deepEqual(item, before);
});
