import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationShortcutLayout } from '../src/native-conversation-shortcut-layout.mjs';

function fixture() {
  let writes = 0, callback;
  const element = () => ({ attrs: new Map(), values: new Map(),
    setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, remove() { this.removed = true; },
    get style() { const values = this.values; return { getPropertyValue: k => values.get(k) || '', setProperty(k, v) { writes++; values.set(k, v); }, removeProperty(k) { values.delete(k); } }; }
  });
  const host = element();
  host.getBoundingClientRect = () => ({ left: 180, top: 600 + (parseFloat(host.values.get('--ccc-shortcut-height')) || 0), width: 700, height: 100 });
  let current = host;
  const toolbar = element(); toolbar.hidden = true; toolbar.height = 34;
  toolbar.getBoundingClientRect = () => ({ height: toolbar.height });
  const observed = new Set();
  const window = { innerHeight: 900, innerWidth: 1200, getComputedStyle: () => ({ marginTop: '12px' }),
    ResizeObserver: class { constructor(fn) { callback = fn; } observe(n) { observed.add(n); } unobserve(n) { observed.delete(n); } disconnect() { observed.clear(); } } };
  const dialogs = [];
  const document = { head: { append() {} }, createElement: element, querySelectorAll: () => dialogs, querySelector: () => current && ({ closest: () => current }) };
  const layout = createConversationShortcutLayout(document, window, toolbar);
  return { layout, host, toolbar, observed, dialogs, writes: () => writes, resize: () => callback(), switchTo: node => { current = node; }, window };
}

test('shortcuts reserve real space above the composer instead of covering goal/task content', () => {
  const f = fixture(); f.layout.update();
  assert.equal(f.host.values.get('--ccc-shortcut-base-margin'), '12px');
  assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
  const toolbarBottom = 900 - parseFloat(f.toolbar.values.get('bottom'));
  assert.equal(toolbarBottom - f.toolbar.height, 608, 'toolbar starts below the preceding task edge at 600');
  assert.equal(f.toolbar.hidden, false);
  assert.equal(f.toolbar.values.get('left'), '192px');
  assert.equal(f.toolbar.values.get('width'), '676px');
  const writes = f.writes(); f.layout.update();
  assert.equal(f.writes(), writes, 'stable layout performs no repeated style writes');
});

test('resize updates reserved height and removal releases layout and observers', () => {
  const f = fixture(); f.layout.update();
  f.toolbar.height = 50; f.resize();
  assert.equal(f.host.values.get('--ccc-shortcut-height'), '66px');
  f.switchTo(null); f.layout.update();
  assert.equal(f.toolbar.hidden, true);
  assert.equal(f.host.attrs.size, 0); assert.equal(f.host.values.size, 0);
  assert.equal(f.observed.has(f.host), false);
  f.switchTo(f.host); f.layout.update(); f.layout.dispose();
  assert.equal(f.host.attrs.size, 0); assert.equal(f.observed.size, 0);
  f.resize(); assert.equal(f.host.values.size, 0);
});

test('visible hooks/dialog overlays hide shortcuts while preserving spacing, then restore them', () => {
  const f = fixture(); f.layout.update();
  const dialog = { hidden: false, getAttribute: () => null, getClientRects: () => [{}] };
  f.dialogs.push(dialog); f.layout.update();
  assert.equal(f.toolbar.hidden, true);
  assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
  dialog.hidden = true; f.layout.update(); assert.equal(f.toolbar.hidden, false);
  dialog.hidden = false; dialog.getClientRects = () => [];
  f.layout.update(); assert.equal(f.toolbar.hidden, false, 'a dialog inside a hidden parent does not suppress shortcuts');
  dialog.getClientRects = () => [{}]; dialog.getAttribute = key => key === 'data-state' ? 'closed' : null;
  f.layout.update(); assert.equal(f.toolbar.hidden, false);
  f.dialogs.length = 0; f.layout.update(); assert.equal(f.toolbar.hidden, false);
});

test('toolbar follows native composer surface and font across appearances', () => {
  const f = fixture();
  let backgroundColor = 'rgb(48, 48, 48)';
  f.window.getComputedStyle = () => ({ marginTop: '12px', backgroundColor, fontFamily: 'Native Sans' });
  f.layout.update();
  assert.equal(f.toolbar.values.get('--ccc-shortcut-surface'), backgroundColor);
  assert.equal(f.toolbar.values.get('--ccc-shortcut-font'), 'Native Sans');
  backgroundColor = 'rgb(255, 255, 255)'; f.layout.update();
  assert.equal(f.toolbar.values.get('--ccc-shortcut-surface'), backgroundColor);
  backgroundColor = 'rgba(0, 0, 0, 0)'; f.layout.update();
  assert.equal(f.toolbar.values.has('--ccc-shortcut-surface'), false);
});
