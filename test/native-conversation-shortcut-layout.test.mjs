import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationShortcutLayout } from '../src/native-conversation-shortcut-layout.mjs';

function fixture() {
  let writes = 0, callback;
  const element = (tag = 'div') => ({ attrs: new Map(), values: new Map(), isConnected: true, tagName: tag.toUpperCase(),
    setAttribute(k, v) { this.attrs.set(k, v); }, removeAttribute(k) { this.attrs.delete(k); }, remove() { this.removed = true; },
    getAttribute(k) { return this.attrs.get(k) ?? null; }, getClientRects() { return this.hidden || !this.isConnected ? [] : [{}]; },
    matches(selector) {
      if (selector === ':modal') return this.modal === true;
      const tag = selector.match(/^\w+/)?.[0];
      return (!tag || tag.toUpperCase() === this.tagName) && Array.from(selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g))
        .every(([, key, value]) => this.attrs.has(key) && (value === undefined || this.getAttribute(key) === value));
    },
    get style() { const values = this.values; return { getPropertyValue: k => values.get(k) || '', setProperty(k, v) { writes++; values.set(k, v); }, removeProperty(k) { values.delete(k); } }; }
  });
  const host = element();
  host.getBoundingClientRect = () => ({ left: 180, top: 600 + (parseFloat(host.values.get('--ccc-shortcut-height')) || 0), width: 700, height: 100 });
  const composer = surface => {
    const node = element(); node.setAttribute('data-codex-composer', 'true'); node.setAttribute('contenteditable', 'true');
    node.closest = selector => selector === '[data-composer-surface-variant]' ? surface : null; return node;
  };
  const form = (left = 240, placement = 'thread') => {
    const node = element('form'); node.setAttribute('data-thread-find-composer', 'true'); node.setAttribute('data-composer-placement', placement);
    node.getBoundingClientRect = () => ({ left, top: 580 + (parseFloat(node.values.get('--ccc-shortcut-height')) || 0), width: 720, height: 100 }); return node;
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
  const document = { head: { append() {} }, createElement: element, querySelectorAll: selector => selector === '[data-codex-composer="true"]' || selector.startsWith('form[')
    ? candidates.filter(node => node.matches(selector))
    : selector.startsWith('dialog') ? dialogs : selector.startsWith('[data-reasoning-slider]') ? modelControls : menus,
    querySelector: selector => candidates.find(node => selector.startsWith('[data-codex-composer="true"]')
      && node.getAttribute('data-codex-composer') === 'true'
      && (!selector.includes('[contenteditable="true"]') || node.getAttribute('contenteditable') === 'true')) || null };
  const layout = createConversationShortcutLayout(document, window, toolbar);
  return { layout, host, toolbar, observed, dialogs, menus, modelControls, editor, candidates, element, composer, form,
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

test('New chat Codex surfaces transition to ChatGPT and Work home/thread forms, including inert read-only forms', () => {
  for (const [work, placement] of [[false, 'home'], [false, 'thread'], [true, 'home'], [true, 'thread']]) {
    const f = fixture(); f.layout.update(); const form = f.form(260, placement);
    if (!work) form.setAttribute('data-chatgpt-composer', '');
    form.setAttribute('inert', ''); form.inert = true; form.setAttribute('contenteditable', 'false');
    f.host.hidden = true; f.candidates.push(form); f.layout.update();
    assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '272px');
    assert.equal(f.observed.has(form), true); assert.equal(f.observed.has(f.host), false);
    assert.equal(f.host.values.size, 0); assert.equal(form.values.get('--ccc-shortcut-height'), '50px');
    assert.equal(form.inert, true); assert.equal(form.getAttribute('contenteditable'), 'false', 'layout grants no input permission');
    assert.equal(form.attrs.has('data-chatgpt-composer'), !work, 'Work does not need the optional ChatGPT marker');
    const writes = f.writes(); for (let index = 0; index < 5; index++) f.layout.update();
    assert.equal(f.writes(), writes, 'the form keeps stable spacing');
    f.host.hidden = false; form.isConnected = false; f.layout.update();
    assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '192px');
    assert.equal(form.values.size, 0); assert.equal(form.attrs.has('data-ccc-shortcut-space'), false);
    assert.equal(form.attrs.has('inert'), true); assert.equal(f.observed.has(form), false);
  }
});

test('old native forms yield to visible replacements and recover after remount with owned cleanup', () => {
  const f = fixture(), old = f.form(), fresh = f.form(300);
  f.candidates.splice(0, f.candidates.length, old, fresh); f.layout.update();
  old.hidden = true; f.layout.update();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '312px');
  assert.equal(f.observed.has(old), false); assert.equal(old.values.size, 0);
  for (const invalidate of [() => { old.isConnected = false; }, () => { old.appearance = { display: 'none' }; },
    () => { old.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 }); }]) {
    old.hidden = false; old.isConnected = true; old.appearance = {}; invalidate(); f.layout.update();
    assert.equal(f.toolbar.hidden, false); assert.equal(f.observed.has(fresh), true);
  }
  fresh.isConnected = false; f.layout.update(); assert.equal(f.toolbar.hidden, true);
  assert.equal(fresh.values.size, 0); assert.equal(f.observed.has(fresh), false);
  const remounted = f.form(340); f.candidates.push(remounted); f.layout.update();
  assert.equal(f.toolbar.hidden, false); assert.equal(f.toolbar.values.get('left'), '352px');
  const writes = f.writes(); f.resize(); f.layout.update(); assert.equal(f.writes(), writes);
  f.layout.dispose(); assert.equal(remounted.values.size, 0); assert.equal(f.observed.size, 0);
  assert.equal(remounted.getAttribute('data-thread-find-composer'), 'true', 'cleanup preserves native markers');
});

test('generic forms, non-form elements and incomplete native form markers are ignored', () => {
  const f = fixture(); f.candidates.length = 0;
  const generic = f.element('form'); generic.setAttribute('data-chatgpt-composer', '');
  const noPlacement = f.form(); noPlacement.removeAttribute('data-composer-placement');
  const noThreadFind = f.form(); noThreadFind.removeAttribute('data-thread-find-composer');
  const wrongThreadFind = f.form(); wrongThreadFind.setAttribute('data-thread-find-composer', 'false');
  const nonForm = f.form(); nonForm.tagName = 'TEXTAREA';
  f.candidates.push(generic, noPlacement, noThreadFind, wrongThreadFind, nonForm); f.layout.update();
  assert.equal(f.toolbar.hidden, true); assert.equal(f.observed.size, 1, 'only the toolbar is observed');
  assert.equal(f.writes(), 0); for (const node of f.candidates) assert.equal(node.attrs.has('data-ccc-shortcut-space'), false);
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

test('visible modal overlays hide shortcuts while preserving spacing, then restore them', () => {
  const f = fixture(); f.layout.update();
  const dialog = f.element(); dialog.setAttribute('aria-modal', 'true');
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

test('nonmodal role and HTML dialogs yield only while overlapping, retain hidden bounds and recover', () => {
  for (const tag of ['div', 'dialog']) {
    const f = fixture(); f.layout.update(); const panel = f.element(tag);
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'false');
    if (tag === 'dialog') panel.setAttribute('open', '');
    let bounds = { left: 10, right: 160, top: 20, bottom: 170 };
    panel.getBoundingClientRect = () => bounds; f.dialogs.push(panel);
    const writes = f.writes(); f.layout.update();
    assert.equal(f.toolbar.hidden, false, 'distant nonmodal panels do not suppress page chrome');
    assert.equal(f.writes(), writes);
    bounds = { left: 700, right: 900, top: 590, bottom: 700 }; f.layout.update();
    assert.equal(f.toolbar.hidden, true); assert.equal(f.host.values.get('--ccc-shortcut-height'), '50px');
    for (let index = 0; index < 5; index++) { f.resize(); assert.equal(f.toolbar.hidden, true, 'the previous hit area prevents flashing'); }
    assert.equal(f.writes(), writes);
    bounds = { left: 900, right: 1100, top: 590, bottom: 700 }; f.layout.update(); assert.equal(f.toolbar.hidden, false);
    bounds = { left: 700, right: 900, top: 590, bottom: 700 }; f.layout.update(); assert.equal(f.toolbar.hidden, true);
    panel.hidden = true; f.layout.update(); assert.equal(f.toolbar.hidden, false, 'closing restores the bar');
    panel.hidden = false; panel.owned = true; f.layout.update(); assert.equal(f.toolbar.hidden, false, 'owned toolbar panels stay usable');
    panel.owned = false; panel.setAttribute('data-state', 'closed'); f.layout.update(); assert.equal(f.toolbar.hidden, false);
  }
});

test('aria-modal, native top-layer modal and alertdialog gates suppress globally even when distant', () => {
  for (const gate of ['aria-modal', 'native', 'alertdialog']) {
    const f = fixture(); f.layout.update(); const panel = f.element(gate === 'native' ? 'dialog' : 'div');
    if (gate === 'aria-modal') panel.setAttribute('aria-modal', 'true');
    if (gate === 'alertdialog') panel.setAttribute('role', 'alertdialog');
    if (gate === 'native') { panel.setAttribute('open', ''); panel.modal = true; }
    panel.getBoundingClientRect = () => ({ left: 10, right: 160, top: 20, bottom: 170 }); f.dialogs.push(panel);
    f.layout.update(); assert.equal(f.toolbar.hidden, true, gate);
    f.layout.update(); assert.equal(f.toolbar.hidden, true, 'a modal gate does not flash the toolbar');
    panel.hidden = true; f.layout.update(); assert.equal(f.toolbar.hidden, false);
  }
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
