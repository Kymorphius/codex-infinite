import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeClaimTaskBridge } from '../src/native-claim-task-control.mjs';

function fakePage() {
  const button = { dataset: {}, textContent: '', title: '', addEventListener() {} };
  let cssWrites = 0, order = '';
  // Like the real CSSOM: assigning cssText replaces every inline declaration, including `order`.
  button.style = { get order() { return order; }, set order(value) { order = value; },
    set cssText(value) { cssWrites++; order = /(?:^|;)order:(\d+)/.exec(value)?.[1] || ''; } };
  let created = false;
  const host = { insertBefore() {} };
  const document = { querySelector: selector => (selector === '[data-ccc-claim-task]' && created ? button : null), createElement: () => { created = true; return button; } };
  const bridge = vm.runInContext(`(${createNativeClaimTaskBridge.toString()})(() => 'thread')`, vm.createContext({ document, window: {} }));
  return { bridge, host, button, cssWrites: () => cssWrites };
}

test('the claim button style is written once so control-order keeps its slot', () => {
  // Regression: ensure() reset the whole inline style on every call, wiping the `order` that
  // native-composer-control-order had set; control-order restored it and the next call reset it again
  // (34 real style changes per 10s), invalidating style across the page.
  const { bridge, host, button, cssWrites } = fakePage();
  bridge.ensure(host, null);
  assert.equal(cssWrites(), 1); assert.equal(button.style.order, '2', 'created with its default slot');
  button.style.order = '4'; // control-order moves it to the user's chosen position
  for (let i = 0; i < 5; i++) bridge.ensure(host, null);
  assert.equal(cssWrites(), 1, 'later calls do not rewrite the style');
  assert.equal(button.style.order, '4', 'the chosen slot survives');
  bridge.set(7);
  assert.equal(button.textContent, '领任务 7', 'label updates still work');
});
