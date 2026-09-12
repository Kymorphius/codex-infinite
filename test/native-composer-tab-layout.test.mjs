import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativePageTabInset } from '../src/native-composer-tab-layout.mjs';
test('native page reserves one fixed row across route changes and removes it on disposal', () => {
  const styles = [];
  const document = { head: { append(style) { styles.push(style); } }, createElement() { return { remove() { this.removed = true; } }; } };
  const make = () => ({ attrs: {}, matches: () => true, setAttribute(k,v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } });
  const first = make(), next = make(), inset = createNativePageTabInset(document);
  inset.update(first); inset.update(first); assert.equal(styles.length, 1); assert.equal(Object.keys(first.attrs).length, 1);
  assert.match(styles[0].textContent, /padding-top:36px/);
  assert.match(styles[0].textContent, />header:not\(:has\(>\[data-testid="app-shell-header-context-menu-surface"\]\)\)\{top:36px/);
  assert.match(styles[0].textContent, />header>\[data-testid="app-shell-header-context-menu-surface"\]\{translate:0 36px\}/);
  assert.doesNotMatch(styles[0].textContent, /translate:0 -36px/);
  inset.update(next); assert.equal(Object.keys(first.attrs).length, 0); assert.equal(Object.keys(next.attrs).length, 1);
  inset.update({ matches: () => false }); assert.equal(Object.keys(next.attrs).length, 0);
  inset.update(next); inset.dispose(); assert.equal(Object.keys(next.attrs).length, 0); assert.equal(styles[0].removed, true);
});
