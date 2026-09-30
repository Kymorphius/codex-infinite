import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ModelCatalog } from '../src/context-window.mjs';
import { TurboPolicyService, TurboPolicyStore } from '../src/turbo-policy.mjs';

// Relevant native Codex 0.159.0 metadata, rather than public API capabilities.
const model = {
  slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list',
  supported_in_api: true, default_reasoning_level: 'low',
  supported_reasoning_levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']
    .map(effort => ({ effort })),
  context_window: 272000, max_context_window: 872000,
  effective_context_window_percent: 95,
  service_tiers: [{ id: 'fast', name: 'Fast' }]
};

test('current native GPT-6.1 Sol metadata flows through catalog, Turbo and context limits', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'chatgpt-catalog-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'models.json');
  await fs.writeFile(filePath, JSON.stringify({ client_version: '0.159.0', models: [model] }));
  const modelCatalog = new ModelCatalog({ filePath });
  const options = await modelCatalog.listOptions();
  assert.equal(options[0].id, 'gpt-6.1-sol');
  assert.equal(options[0].defaultReasoningEffort, 'low');
  assert.deepEqual(options[0].reasoningEfforts.map(item => item.effort),
    ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  assert.deepEqual(options[0].serviceTiers.map(item => item.id), ['default', 'priority']);

  const store = new TurboPolicyStore({ filePath: path.join(directory, 'turbo.json') });
  await store.init();
  const service = new TurboPolicyService({ store, modelCatalog });
  const refreshed = await service.refreshCatalog();
  assert.equal(refreshed.enabled, false);
  assert.equal(refreshed.model, null);
  assert.deepEqual(refreshed.modelOptions[0], { id: 'gpt-6.1-sol', efforts: model.supported_reasoning_levels.map(item => item.effort) });
  assert.deepEqual(refreshed.modelEfforts, [{ model: 'gpt-6.1-sol', effort: 'ultra' }]);
  const selected = await service.update({ model: 'gpt-6.1-sol', reasoningEffort: 'ultra' });
  assert.equal(selected.model, 'gpt-6.1-sol');
  assert.equal(selected.enabled, false);
  await assert.rejects(service.update({ reasoningEffort: 'none' }), /不支持/);
  const reloaded = new TurboPolicyStore({ filePath: store.filePath });
  await reloaded.init();
  assert.equal(reloaded.snapshot().model, 'gpt-6.1-sol');
  assert.equal(reloaded.snapshot().reasoningEffort, 'ultra');

  const context = await modelCatalog.resolve('gpt-6.1-sol', 1000000);
  assert.equal(context.modelDefaultContextWindow, 272000);
  assert.equal(context.acceptedContextWindow, 872000);
  assert.equal(context.estimatedEffectiveContextWindow, 828400);
  assert.equal(context.clamped, true);
});
