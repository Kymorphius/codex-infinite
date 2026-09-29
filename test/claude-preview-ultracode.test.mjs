import test from 'node:test';
import assert from 'node:assert/strict';
import { createClaudePreviewSelection } from '../src/claude-preview-selection.mjs';
import { buildNativeClaudePreviewInjectionScript } from '../src/native-claude-preview.mjs';

const id = '11111111-1111-4111-8111-111111111111';
test('ultracode selects the Codex ultra rung, persists as ultracode and restores the original', async () => {
  const values = new Map(), initial = { model: 'gpt-6-sol', reasoningEffort: 'medium' };
  let current = { ...initial };
  const options = { storage: { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v) },
    read: async () => current, apply: async (_id, next) => { current = next; } };
  const controller = createClaudePreviewSelection(options);
  await controller.set(id, 'ultracode');
  assert.deepEqual(current, { model: 'claude-subscription/opus-native', reasoningEffort: 'ultra' });
  assert.equal(createClaudePreviewSelection(options).selected(id).effort, 'ultracode');
  await controller.set(id, null);
  assert.deepEqual(current, initial);
  await assert.rejects(controller.set(id, 'ultracode', true, 'haiku'), /无效/);
});
test('the settings panel offers ultracode', () => {
  assert.match(buildNativeClaudePreviewInjectionScript(), /ultracode: 'Ultracode（多智能体）'/);
});
