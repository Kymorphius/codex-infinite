import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeChecklistInput } from '../src/project-checklist-input.mjs';

test('serialized native checklist input normalizer supports image references without module scope', () => {
  const input = [{ type: 'text', text: '带图待办' }, { type: 'heldImage', id: '11111111-1111-4111-8111-111111111111:0' }];
  const normalize = vm.runInNewContext(`(${normalizeChecklistInput.toString()})`);
  assert.deepEqual(JSON.parse(JSON.stringify(normalize(input))), input);
  assert.throws(() => normalize([{ type: 'heldImage', id: '/arbitrary/path.png' }]), /无效/);
  assert.throws(() => normalize([input[1], input[1]]), /无效/);
});
