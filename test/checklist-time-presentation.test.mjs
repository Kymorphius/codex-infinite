import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistTimeMetadata } from '../src/project-checklist-time.mjs';
import { createChecklistTimePresentation } from '../src/checklist-time-presentation.mjs';

const presentation = createChecklistTimePresentation(checklistTimeMetadata);
test('added time order is a stable projection including mixed held and assigned tasks, with unknown dates last', () => {
  const items = [
    { id: 'unknown' },
    { id: 'late', createdAt: '2026-09-22T01:00:00.000Z' },
    { id: 'held', heldAt: Date.parse('2026-09-20T01:00:00.000Z') },
    { id: 'legacy', updatedAt: '2026-09-21T01:00:00.000Z' },
    { id: 'same', createdAt: '2026-09-20T01:00:00.000Z' },
    { id: 'unknown2', createdAt: null }
  ];
  assert.deepEqual(presentation.order(items).map(item => item.id), ['held', 'same', 'legacy', 'late', 'unknown', 'unknown2']);
  assert.equal(items[0].id, 'unknown');
  assert.equal(presentation.order(items)[0], items[2]);
});

test('date labels are local absolute times with a full seconds tooltip, not live relative timers', () => {
  const instant = new Date(2026, 8, 22, 8, 9, 10).toISOString();
  assert.deepEqual(presentation.describe({ createdAt: instant }), {
    dateTime: instant, label: '加入 2026-09-22 08:09', title: '最初加入时间：2026-09-22 08:09:10'
  });
  assert.deepEqual(presentation.describe({ heldAt: Date.parse(instant) }), presentation.describe({ createdAt: instant }));
  assert.equal(presentation.describe({ updatedAt: instant }).label, '加入约 2026-09-22 08:09');
  assert.equal(presentation.describe({ createdAt: null }).dateTime, '');
  assert.doesNotMatch(createChecklistTimePresentation.toString(), /setInterval|setTimeout|MutationObserver/);
});
