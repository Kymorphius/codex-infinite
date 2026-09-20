import test from 'node:test';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createExperimentsFeature } from '../public/features/experiments/index.js';
import { resolveStaticAsset } from '../src/static-assets.mjs';
import { createAppState } from '../public/core/state.js';
class Element {
  constructor() { this.children = []; this.listeners = {}; this.checked = false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}
const flatten = node => [node.textContent || '', ...node.children.flatMap(flatten)].join('\n');
test('enabled filtering, unavailable categories, literal text and stale refresh are explicit', async () => {
  const elements = new Map();
  const $ = key => { if (!elements.has(key)) elements.set(key, new Element()); return elements.get(key); };
  const feature = createExperimentsFeature({ $, documentRef: { createElement: () => new Element() }, fetchImpl: async () => { throw Error('offline'); } });
  feature.bind();
  feature.render({ devices: [{ device: { name: '<img onerror=alert(1)>' }, snapshot: {
    native: { status: 'connected', items: [{ name: 'enabled-item', enabled: true }, { name: 'disabled-item', enabled: false }] },
    console: { status: 'unavailable' }
  } }] });
  const list = $('[data-testid="experiments-devices"]');
  assert.match(flatten(list), /enabled-item/);
  assert.doesNotMatch(flatten(list), /disabled-item/);
  assert.match(flatten(list), /暂时无法读取/);
  assert.match(flatten(list), /<img onerror=alert\(1\)>/);
  const filter = $('[data-testid="experiments-all"]');
  filter.checked = true; filter.listeners.change();
  assert.match(flatten(list), /disabled-item/);
  await feature.load();
  assert.match($('[data-testid="experiments-status"]').textContent, /上次读取结果/);
});
test('experiment deep link and public assets are registered', () => {
  assert.equal(createAppState('experiments').module, 'experiments');
  assert.ok(resolveStaticAsset('/features/experiments/index.js'));
  assert.ok(resolveStaticAsset('/styles/experiments.css'));
  assert.ok(resolveStaticAsset('/').fragmentPaths.some(p => path.basename(p) === 'experiments.html'));
});
