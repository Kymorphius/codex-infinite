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
  toolbar.getBoundingClientRect = () => toolbar.hidden ? ({ height: 0, width: 0, left: 0, right: 0, top: 0, bottom: 0 })
    : ({ height: toolbar.height, width: 676, left: 192, right: 868, top: 608, bottom: 642 });
  toolbar.contains = node => node?.owned === true;
  const observed = new Set();
  const window = { innerHeight: 900, innerWidth: 1200, getComputedStyle: () => ({ marginTop: '12px' }),
    ResizeObserver: class { constructor(fn) { callback = fn; } observe(n) { observed.add(n); } unobserve(n) { observed.delete(n); } disconnect() { observed.clear(); } } };
  const dialogs = [], menus = [], modelControls = [];
  const document = { head: { append() {} }, createElement: element, querySelectorAll: selector => selector.startsWith('dialog') ? dialogs : selector.startsWith('[data-reasoning-slider]') ? modelControls : menus, querySelector: () => current && ({ closest: () => current }) };
  const layout = createConversationShortcutLayout(document, window, toolbar);
  return { layout, host, toolbar, observed, dialogs, menus, modelControls, writes: () => writes, resize: () => callback(), switchTo: node => { current = node; }, window };
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

test('model and reasoning controls yield space even without menu or dialog semantics', () => {
  const f = fixture(); f.layout.update();
  const control = { hidden: false, getAttribute: () => null, getClientRects: () => [{}] };
  f.modelControls.push(control);
  f.layout.update(); assert.equal(f.toolbar.hidden, true);
  f.layout.update(); assert.equal(f.toolbar.hidden, true);
  assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
  control.getClientRects = () => [];
  f.layout.update(); assert.equal(f.toolbar.hidden, false);
  control.getClientRects = () => [{}];
  f.layout.update(); assert.equal(f.toolbar.hidden, true);
  f.modelControls.length = 0;
  f.layout.update(); assert.equal(f.toolbar.hidden, false);
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

test('overlapping native menus yield to their actions while own and distant menus remain usable', () => {
  const f = fixture(); f.layout.update();
  const menu = { hidden: false, owned: false, getAttribute: () => null, getClientRects: () => [{}],
    getBoundingClientRect: () => ({ left: 700, right: 900, top: 590, bottom: 700 }) };
  f.menus.push(menu); f.layout.update(); assert.equal(f.toolbar.hidden, true);
  f.layout.update(); assert.equal(f.toolbar.hidden, true, 'hidden toolbar retains its previous hit area without flashing');
  assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
  menu.owned = true; f.layout.update(); assert.equal(f.toolbar.hidden, false);
  menu.owned = false; menu.getBoundingClientRect = () => ({ left: 900, right: 1100, top: 590, bottom: 700 });
  f.layout.update(); assert.equal(f.toolbar.hidden, false);
  menu.hidden = true; f.layout.update(); assert.equal(f.toolbar.hidden, false);
});
