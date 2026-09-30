import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveModelCatalogPath } from '../src/model-catalog-path.mjs';
import { getConfig } from '../src/config.mjs';

test('an existing dedicated native catalog wins over a shared CLI catalog', () => {
  const nativeCodexHome = '/Users/test/.codex-control-console';
  const sourceCodexHome = '/Users/test/.codex';
  const available = new Set([`${nativeCodexHome}/models_cache.json`, `${sourceCodexHome}/models_cache.json`]);
  const checked = [];
  assert.equal(resolveModelCatalogPath({ nativeCodexHome, sourceCodexHome, platform: 'darwin', fileExists: file => { checked.push(file); return available.has(file); } }), `${nativeCodexHome}/models_cache.json`);
  assert.deepEqual(checked, [`${nativeCodexHome}/models_cache.json`], 'shared cache age or contents do not choose the native app catalog');
});

test('an absent native catalog falls back to the source home without requiring that cache to exist', () => {
  const checked = [];
  const actual = resolveModelCatalogPath({ nativeCodexHome: '/home/test/native', sourceCodexHome: '/home/test/.codex', platform: 'linux', fileExists: file => { checked.push(file); return false; } });
  assert.equal(actual, '/home/test/.codex/models_cache.json');
  assert.deepEqual(checked, ['/home/test/native/models_cache.json']);
});

test('an explicit catalog path is preserved exactly and performs no existence lookup', () => {
  for (const overridePath of ['../operator-chosen/models.json', 'C:\\custom cache\\models.json']) {
    assert.equal(resolveModelCatalogPath({ overridePath, fileExists: () => { throw new Error('Explicit paths must not probe the filesystem'); } }), overridePath);
  }
});

test('an empty catalog override preserves the existing default-path behavior', () => {
  const checked = [];
  assert.equal(resolveModelCatalogPath({ overridePath: '', nativeCodexHome: '/native', sourceCodexHome: '/source', platform: 'darwin', fileExists: file => { checked.push(file); return false; } }), '/source/models_cache.json');
  assert.deepEqual(checked, ['/native/models_cache.json']);
});

test('Windows caches use backslashes and keep the same native and source home path', () => {
  const nativeCodexHome = 'C:\\Users\\Admin\\.codex', sourceCodexHome = nativeCodexHome;
  for (const exists of [true, false]) {
    const checked = [];
    assert.equal(resolveModelCatalogPath({ nativeCodexHome, sourceCodexHome, platform: 'win32', fileExists: file => { checked.push(file); return exists; } }), 'C:\\Users\\Admin\\.codex\\models_cache.json');
    assert.deepEqual(checked, ['C:\\Users\\Admin\\.codex\\models_cache.json']);
  }
});

test('Windows fallback retains the source home when an independently configured native cache is absent', () => {
  assert.equal(resolveModelCatalogPath({ nativeCodexHome: 'D:\\native', sourceCodexHome: 'C:\\Users\\Admin\\.codex', platform: 'win32', fileExists: () => false }), 'C:\\Users\\Admin\\.codex\\models_cache.json');
});

test('startup config uses the native cache when populated and preserves explicit overrides', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-model-catalog-path-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nativeHome = path.join(home, '.codex-control-console'), sourceHome = path.join(home, '.codex');
  fs.mkdirSync(nativeHome); fs.mkdirSync(sourceHome);
  fs.writeFileSync(path.join(sourceHome, 'models_cache.json'), '{"models":[{"slug":"gpt-6-sol"}]}');
  for (const platform of ['darwin', 'linux']) {
    const before = getConfig({ CODEX_CONTROL_CODEX_PATH: 'codex' }, home, platform);
    assert.equal(before.modelCatalogPath, path.join(sourceHome, 'models_cache.json'));
  }
  fs.writeFileSync(path.join(nativeHome, 'models_cache.json'), '{"models":[{"slug":"gpt-6.1-sol"}]}');
  for (const platform of ['darwin', 'linux']) {
    const config = getConfig({ CODEX_CONTROL_CODEX_PATH: 'codex' }, home, platform);
    assert.equal(config.modelCatalogPath, path.join(nativeHome, 'models_cache.json'));
    assert.equal(config.nativeCodexHome, nativeHome);
    assert.equal(config.sourceCodexHome, sourceHome);
    assert.equal(config.sessionRoot, path.join(sourceHome, 'sessions'), 'session ownership remains unchanged');
    assert.equal(getConfig({ CODEX_CONTROL_MODEL_CATALOG_PATH: '../explicit.json', CODEX_CONTROL_CODEX_PATH: 'codex' }, home, platform).modelCatalogPath, '../explicit.json');
  }
});

test('Windows startup config selects its shared native home without changing its wrapper profile', () => {
  const config = getConfig({}, 'C:\\Users\\Admin', 'win32');
  assert.equal(config.modelCatalogPath, 'C:\\Users\\Admin\\.codex\\models_cache.json');
  assert.equal(config.nativeCodexHome, config.sourceCodexHome);
  assert.notEqual(config.nativeCodexHome, config.wrapperCodexHome);
});

test('startup composition follows configured native and source home overrides', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-custom-model-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const nativeHome = path.join(root, 'custom-native'), sourceHome = path.join(root, 'custom-source');
  fs.mkdirSync(nativeHome); fs.mkdirSync(sourceHome);
  const nativeCache = path.join(nativeHome, 'models_cache.json'), sourceCache = path.join(sourceHome, 'models_cache.json');
  fs.writeFileSync(sourceCache, '{"models":[]}'); fs.writeFileSync(nativeCache, '{"models":[]}');
  const env = { CODEX_CONTROL_CODEX_HOME: nativeHome, CODEX_CONTROL_SOURCE_CODEX_HOME: sourceHome, CODEX_CONTROL_CODEX_PATH: 'codex' };
  assert.equal(getConfig(env, root, 'darwin').modelCatalogPath, nativeCache);
  assert.equal(getConfig(env, root, 'linux').modelCatalogPath, nativeCache);
  fs.unlinkSync(nativeCache);
  assert.equal(getConfig(env, root, 'darwin').modelCatalogPath, sourceCache);
});
