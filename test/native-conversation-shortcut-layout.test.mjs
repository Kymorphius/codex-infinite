import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationShortcutLayout } from '../src/native-conversation-shortcut-layout.mjs';

function fixture() {
  let writes = 0, callback;
  const element = () => ({ attrs: new Map(), values: new Map(), isConnected: true,
    setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, remove() { this.removed = true; },
    getAttribute(k) { return this.attrs.get(k) ?? null; }, getClientRects() { return this.hidden || !this.isConnected ? [] : [{}]; },
    get style() { const values = this.values; return { getPropertyValue: k => values.get(k) || '', setProperty(k, v) { writes++; values.set(k, v); }, removeProperty(k) { values.delete(k); } }; }
  });
  const host = element();
  host.getBoundingClientRect = () => ({ left: 180, top: 600 + (parseFloat(host.values.get('--ccc-shortcut-height')) || 0), width: 700, height: 100 });
  const composer = surface => {
    const node = element(); node.setAttribute('data-codex-composer', 'true'); node.setAttribute('contenteditable', 'true');
    node.closest = selector => selector === '[data-composer-surface-variant]' ? surface : null; return node;
  };
  const editor = composer(host), candidates = [editor];
  const toolbar = element(); toolbar.hidden = true; toolbar.height = 34;
  toolbar.getBoundingClientRect = () => toolbar.hidden ? ({ height: 0, width: 0, left: 0, right: 0, top: 0, bottom: 0 })
    : ({ height: toolbar.height, width: 676, left: 192, right: 868, top: 608, bottom: 642 });
  toolbar.contains = node => node?.owned === true;
  const observed = new Set();
  const window = { innerHeight: 900, innerWidth: 1200, getComputedStyle: node => ({ marginTop: '12px', ...node.appearance }),
    ResizeObserver: class { constructor(fn) { callback = fn; } observe(n) { observed.add(n); } unobserve(n) { observed.delete(n); } disconnect() { observed.clear(); } } };
  const dialogs = [], menus = [], modelControls = [];
  const document = { head: { append() {} }, createElement: element, querySelectorAll: selector => selector === '[data-codex-composer="true"]'
    ? candidates.filter(node => node.getAttribute('data-codex-composer') === 'true')
    : selector.startsWith('dialog') ? dialogs : selector.startsWith('[data-reasoning-slider]') ? modelControls : menus,
    querySelector: selector => candidates.find(node => selector.startsWith('[data-codex-composer="true"]')
      && node.getAttribute('data-codex-composer') === 'true'
      && (!selector.includes('[contenteditable="true"]') || node.getAttribute('contenteditable') === 'true')) || null };
  const layout = createConversationShortcutLayout(document, window, toolbar);
  return { layout, host, toolbar, observed, dialogs, menus, modelControls, editor, candidates, element, composer,
    writes: () => writes, resize: () => callback(), switchTo: node => { candidates.splice(0, candidates.length, ...(node ? [composer(node)] : [])); }, window };
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

test('visible read-only composers remain anchored through editing-state changes', () => {
  const f = fixture(); f.editor.setAttribute('contenteditable', 'false'); f.layout.update();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.observed.has(f.host), true);
  assert.equal(f.editor.getAttribute('contenteditable'), 'false', 'layout does not authorize typing');
  const writes = f.writes();
  f.editor.setAttribute('contenteditable', 'true'); f.layout.update();
  f.editor.setAttribute('contenteditable', 'false'); f.resize();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.writes(), writes);
});

test('hidden, disconnected and zero-size old composers do not block a later visible surface', () => {
  const f = fixture(), fresh = f.element();
  fresh.getBoundingClientRect = () => ({ left: 240, top: 580, width: 720, height: 100 });
  f.candidates.push(f.composer(fresh));
  for (const invalidate of [() => { f.host.hidden = true; }, () => { f.host.isConnected = false; },
    () => { f.host.appearance = { visibility: 'hidden' }; },
    () => { f.host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }); }]) {
    f.host.hidden = false; f.host.isConnected = true; f.host.appearance = {}; invalidate(); f.layout.update();
    assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '252px');
    assert.equal(f.observed.has(fresh), true); assert.equal(f.observed.has(f.host), false);
  }
  f.host.getBoundingClientRect = () => ({ left: 180, top: 600, width: 700, height: 100 });
  f.candidates[0].hidden = true; f.resize(); assert.equal(f.toolbar.hidden, false);
  assert.equal(f.toolbar.values.get('left'), '252px', 'a hidden editor inside a visible old surface is also skipped');
});

test('candidate surfaces are deduplicated and a removed host releases before remount recovery', () => {
  const f = fixture(); let measurements = 0;
  f.host.getBoundingClientRect = () => { measurements++; return { left: 0, top: 0, width: 0, height: 0 }; };
  // Both markers share a hidden surface; later candidates must still be considered.
  f.host.hidden = true; f.candidates.push(f.composer(f.host));
  const fresh = f.element(); fresh.getBoundingClientRect = () => ({ left: 300, top: 600, width: 700, height: 100 });
  f.candidates.push(f.composer(fresh)); f.layout.update(); assert.equal(f.toolbar.hidden, false);
  assert.equal(measurements, 1, 'duplicate markers do not remeasure the same unusable surface');
  fresh.isConnected = false; f.layout.update(); assert.equal(f.toolbar.hidden, true);
  assert.equal(fresh.attrs.size, 0); assert.equal(f.observed.has(fresh), false);
  const remounted = f.element(); remounted.getBoundingClientRect = () => ({ left: 330, top: 620, width: 710, height: 100 });
  f.candidates.push(f.composer(remounted)); f.layout.update();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '342px');
  assert.equal(f.observed.has(remounted), true); assert.equal(fresh.values.size, 0);
});

test('owned reserved spacing remains stable at a small viewport while a new visible surface takes priority', () => {
  const f = fixture(); f.window.innerHeight = 640; f.layout.update(); f.layout.update();
  assert.equal(f.toolbar.hidden, true, 'the reserved composer has moved outside the viewport');
  const writes = f.writes();
  for (let index = 0; index < 20; index++) {
    index % 2 ? f.resize() : f.layout.update();
    assert.equal(f.toolbar.hidden, true); assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
    assert.equal(f.observed.has(f.host), true);
  }
  assert.equal(f.writes(), writes, 'spacing does not cycle through release and reapply');
  f.window.innerHeight = 900; f.layout.update(); assert.equal(f.toolbar.hidden, false);
  f.window.innerHeight = 640; f.layout.update();
  const fresh = f.element(); fresh.getBoundingClientRect = () => ({ left: 300, top: 400, width: 700, height: 100 });
  f.candidates.push(f.composer(fresh)); f.layout.update();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '312px');
  assert.equal(f.observed.has(fresh), true); assert.equal(f.observed.has(f.host), false);
  assert.equal(f.host.values.size, 0, 'the fallback reservation is released when a better anchor appears');
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
