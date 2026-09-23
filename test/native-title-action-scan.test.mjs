import test from 'node:test';
import assert from 'node:assert/strict';
import { hasVisibleNativeTitleAction } from '../src/native-title-action-scan.mjs';

function button({ sidebar = false, top = 0, bottom = 24, width = 24, height = 24 } = {}) {
  let measurements = 0;
  return {
    closest: () => sidebar ? {} : null,
    getBoundingClientRect: () => { measurements += 1; return { top, bottom, width, height }; },
    measurements: () => measurements
  };
}

test('title preflight ignores sidebar and offscreen actions without scanning unrelated buttons', () => {
  const sidebar = button({ sidebar: true });
  const offscreen = button({ top: -60, bottom: -36 });
  const documentRef = { querySelectorAll(selector) {
    assert.equal(selector, 'button[aria-label="聊天操作"],button[aria-label="Chat actions"]');
    return [sidebar, offscreen];
  } };
  assert.equal(hasVisibleNativeTitleAction(documentRef), false);
  assert.equal(sidebar.measurements(), 0);
  assert.equal(offscreen.measurements(), 1);
});

test('title preflight retains a visible top action', () => {
  const visible = button({ top: 8, bottom: 32 });
  assert.equal(hasVisibleNativeTitleAction({ querySelectorAll: () => [visible] }), true);
  assert.equal(visible.measurements(), 1);
  assert.equal(hasVisibleNativeTitleAction({ querySelectorAll: () => [button({ width: 0 })] }), false);
});
