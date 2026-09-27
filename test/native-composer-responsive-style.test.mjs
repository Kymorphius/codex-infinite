import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_COMPOSER_RESPONSIVE_STYLE as css } from '../src/native-composer-responsive-style.mjs';
import { buildNativeComposerTransitionShieldSource } from '../src/native-composer-transition-shield.mjs';

test('composer auxiliary controls wrap without shrinking buttons or adding polling', () => {
  assert.match(css, /flex:1 1 420px!important/);
  assert.match(css, /flex-shrink:0!important/);
  assert.equal((css.match(/flex-wrap:wrap!important/g) || []).length, 2);
  assert.match(css, /height:auto!important/);
  for (const rule of css.split('}').filter(rule => rule.trim())) assert.match(rule, /^\s*\[data-composer-surface-variant\]/);
  const source = buildNativeComposerTransitionShieldSource();
  assert.match(source, /2026-09-28\.responsive/);
  assert.match(source, /display:none!important/);
  assert.doesNotMatch(source, /setInterval|ResizeObserver/);
  new Function(source);
});
