import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectWrapperNativeCatalog } from '../src/wrapper-native-catalog.mjs';

test('current native model source remains explicit without enabling discovery or changing transport', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'native-catalog-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const router = path.join(home, 'codex-router');
  await fs.mkdir(router);
  const config = `model_catalog_json = ${JSON.stringify(path.join(router, 'merged-models.json'))}\nopenai_base_url = "http://127.0.0.1:4202/jev/v1"\n`;
  await fs.writeFile(path.join(home, 'config.toml'), config);
  const discovery = path.join(router, 'discovery-mode.json');
  await fs.writeFile(discovery, '{"discovery":"disabled"}');
  assert.equal(await connectWrapperNativeCatalog(home), false);
  await fs.writeFile(path.join(home, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-sol', visibility: 'list' }, { slug: 'codex-auto-review', visibility: 'hide' }] }));
  assert.equal(await connectWrapperNativeCatalog(home), true);
  const source = path.join(router, 'native-catalog-source.json');
  assert.deepEqual(JSON.parse(await fs.readFile(source, 'utf8')), { version: 1, status: 'active', path: path.join(home, 'models_cache.json') });
  assert.equal(await connectWrapperNativeCatalog(home), true);
  assert.equal(await fs.readFile(path.join(home, 'config.toml'), 'utf8'), config);
  assert.equal(await fs.readFile(discovery, 'utf8'), '{"discovery":"disabled"}');
  await fs.writeFile(source, '{"version":1,"status":"active","path":"/custom/catalog.json"}');
  assert.equal(await connectWrapperNativeCatalog(home), false);
  assert.equal(JSON.parse(await fs.readFile(source, 'utf8')).path, '/custom/catalog.json');
});
