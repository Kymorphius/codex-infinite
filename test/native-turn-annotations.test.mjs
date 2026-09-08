import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeTurnAnnotations } from '../src/native-turn-annotations.mjs';
const threadId = '01a06856-3552-7180-8fe5-20b74987e2af', turnId = '01a06856-63e5-7a13-a3a9-90bbf2138fdc', other = '01a06858-4767-7de2-834e-366866520195';
function harness() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.style = { setProperty(k,v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; }, removeProperty(k) { delete this[k]; } }; this.listeners = {}; this.isConnected = true; this.value = ''; }
    append(...nodes) { nodes.forEach(n => { this.children.push(n); n.parent = this; }); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, v) { this.listeners[k] = v; }
    contains(n) { return n === this || this.children.some(c => c.contains(n)); }
    remove() { this.isConnected = false; this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
    closest() { return this.hasAttribute('data-thread-user-message-navigation-item-id') ? this : null; }
    getBoundingClientRect() { return { left: 50, right: 70, top: 100, bottom: 110, width: 20, height: 10 }; }
  }
  const all = n => [n, ...n.children.flatMap(all)];
  const body = new Node('body'), head = new Node('head'), host = new Node('main'), marker = new Node('button');
  marker.setAttribute('data-thread-user-message-navigation-item-id', turnId + ':message'); body.append(host, marker);
  let current = { threadId, host, turns: [{ id: turnId, markers: [marker] }] }, tick, now = 1000, sequence = 0, reading = null;
  const timeline = new Node('div');
  const delayed = [];
  const storage = new Map(), listeners = {}, nativePreview = new Node('div');
  nativePreview.className = 'rounded-xl bg-surface-elevated-secondary/95 p-2 text-sm leading-5 shadow-xl-spread';
  let showNative = true, showOutput = false;
  const outputCard = new Node('div'), outputHeading = new Node('button');
  outputHeading.textContent = '输出内容'; outputHeading.closest = () => outputCard;
  outputCard.className = 'rounded-3xl bg-surface-elevated-secondary electron:elevation-prominent';
  outputCard.getBoundingClientRect = () => ({ left: 1050, right: 1350, top: 60, bottom: 300, width: 300, height: 240 });
  const document = { body, head, documentElement: body, activeElement: null, createElement: tag => new Node(tag),
    querySelector: () => showNative ? nativePreview : null, querySelectorAll: selector => selector === 'button' ? (showOutput ? [outputHeading] : []) : all(body).filter(n => n.hasAttribute('data-ccc-annotated')),
    addEventListener: (k, fn) => listeners[k] = fn, removeEventListener() {} };
  const window = { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {} };
  const context = vm.createContext({ getComputedStyle: () => ({ backgroundColor: 'rgb(45, 45, 45)', borderRadius: '25px', boxShadow: 'native-shadow', color: 'white' }), document, window, readContext: () => current, readingTurn: () => reading, localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    crypto: { randomUUID: () => 'req-' + ++sequence }, Date: { now: () => now }, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn(), setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, setTimeout(fn) { delayed.push(fn); } });
  const install = () => vm.runInContext(`(${installNativeTurnAnnotations.toString()})(readContext,'',undefined,undefined,readingTurn)`, context); install();
  return { window, document, marker, storage, listeners, install, nativePreview,
    enableFollow() { current = { ...current, content: { closest: () => timeline }, turns: [...current.turns, { id: other, markers: [] }] }; reading = turnId; tick(); },
    scrollTo(id, target = timeline) { reading = id; listeners.scroll({ target }); },
    settleAt(id) { reading = id; delayed.splice(0).forEach(fn => fn()); }, outputCard, host, showOutput() { showOutput = true; tick(); }, hideNative() { showNative = false; tick(); }, control: () => window.__codexControlConsoleAnnotations,
    node: tag => all(body).find(n => n.tag === tag), preview: () => all(body).find(n => n.hasAttribute('data-ccc-annotation-preview')),
    advance() { now += 1000; tick(); }, switchThread() { current = { ...current, threadId: other }; tick(); } };
}
test('editing colors native ticks, preserves native hover and cannot lose a newer draft to an older acknowledgement', () => {
  const h = harness(), editor = h.node('textarea');
  h.control().accept({ threadId, notes: {}, acknowledged: [] }); assert.equal(editor.disabled, false);
  editor.value = 'first <script>'; editor.listeners.input(); h.advance();
  const first = h.control().packet().actions[0]; assert.equal(first.turnId, turnId); assert.ok(h.marker.hasAttribute('data-ccc-annotated'));
  h.listeners.pointerover({ target: h.marker }); assert.equal(h.preview().hidden, false); assert.equal(h.preview().children[1].textContent, 'first <script>');
  h.document.activeElement = editor; editor.value = 'newer'; editor.listeners.input();
  h.control().accept({ threadId, notes: { [turnId]: { text: 'first <script>' } }, acknowledged: [first.requestId] });
  assert.equal(editor.value, 'newer'); h.advance(); assert.equal(h.control().packet().actions[0].text, 'newer');
  h.listeners.pointerout({ target: h.marker, relatedTarget: null }); assert.equal(h.preview().hidden, true);
});
test('switching conversations retains pending drafts under the original identity and reinstall restores them', () => {
  const h = harness(); h.control().accept({ threadId, notes: {}, acknowledged: [] });
  const editor = h.node('textarea'); editor.value = 'keep me'; editor.listeners.input(); h.advance(); h.switchThread();
  assert.equal(h.control().packet().threadId, other); assert.equal(h.control().packet().actions[0].threadId, threadId);
  assert.equal(editor.value, ''); h.control().version = 'old'; h.install();
  assert.equal(h.control().packet().actions[0].text, 'keep me');
  h.control().accept({ threadId: other, notes: {}, acknowledged: [], error: '保存失败' });
  assert.equal(h.control().packet().actions.length, 1);
});

test('annotation preview matches the native card and attaches below it, releasing layout on dismissal', () => {
  const h = harness(); h.control().accept({ threadId, notes: { [turnId]: { text: 'Note' } }, acknowledged: [] });
  h.listeners.pointerover({ target: h.marker });
  assert.equal(h.preview().className, h.nativePreview.className);
  assert.equal(h.preview().style.left, '50px'); assert.equal(h.preview().style.width, '20px'); assert.equal(h.preview().style.top, '114px');
  assert.equal(h.nativePreview.style.getPropertyValue('--ccc-annotation-height'), '14px');
  h.listeners.pointerout({ target: h.marker, relatedTarget: null });
  assert.equal(h.nativePreview.hasAttribute('data-ccc-annotation-preview-host'), false);
  assert.equal(h.nativePreview.style.getPropertyValue('--ccc-annotation-height'), '');
  h.listeners.pointerover({ target: h.marker }); h.hideNative();
  assert.equal(h.preview().hidden, true, 'wait for the native card instead of showing a separate styled popup');
});

test('right editor shares the output card column and appearance instead of reserving a second gutter', () => {
  const h = harness(); h.showOutput(); const panel = h.node('aside');
  assert.equal(panel.style.left, '1050px'); assert.equal(panel.style.top, '312px'); assert.equal(panel.style.width, '300px');
  assert.equal(panel.style.background, 'rgb(45, 45, 45)'); assert.equal(panel.style.borderRadius, '25px'); assert.equal(panel.style.boxShadow, 'native-shadow');
  assert.equal(h.host.hasAttribute('data-ccc-annotation-layout'), false);
  assert.equal(h.outputCard.hasAttribute('data-ccc-annotation-output-host'), true);
  panel.children[0].children[1].listeners.click();
  assert.equal(panel.hidden, true); assert.equal(h.outputCard.hasAttribute('data-ccc-annotation-output-host'), false);
  h.control().dispose(); assert.equal(h.outputCard.style.getPropertyValue('--ccc-annotation-output-limit'), '');
});

test('timeline scrolling switches notes while preserving old-turn drafts and ignores editor scrolling', () => {
  const h = harness(); h.enableFollow();
  h.control().accept({ threadId, notes: { [turnId]: { text: 'first note' }, [other]: { text: 'second note' } }, acknowledged: [] });
  const editor = h.node('textarea'), select = h.node('select');
  h.document.activeElement = editor; editor.value = 'first draft'; editor.listeners.input();
  let currentText = editor.value, assignments = 0;
  Object.defineProperty(editor, 'value', { get: () => currentText, set: value => { currentText = value; assignments++; } });
  h.scrollTo(turnId); assert.equal(assignments, 0, 'same-turn scrolling must preserve the editor caret');
  h.scrollTo(other, editor); assert.equal(select.value, turnId); assert.equal(editor.value, 'first draft');
  h.scrollTo(other); assert.equal(select.value, other); assert.equal(editor.value, 'second note');
  h.advance(); const pending = h.control().packet().actions[0]; assert.equal(pending.turnId, turnId); assert.equal(pending.text, 'first draft');
  h.control().accept({ threadId, notes: { [turnId]: { text: 'first draft' }, [other]: { text: 'second note' } }, acknowledged: [pending.requestId] });
  assert.equal(editor.value, 'second note'); assert.equal(select.value, other);
  h.scrollTo(turnId); assert.equal(editor.value, 'first draft');
});
test('scroll following waits for composition and background refresh does not override manual selection', () => {
  const h = harness(); h.enableFollow(); h.control().accept({ threadId, notes: { [other]: { text: 'second' } }, acknowledged: [] });
  const editor = h.node('textarea'), select = h.node('select');
  editor.listeners.compositionstart(); editor.value = '中文草稿'; editor.listeners.input();
  h.scrollTo(other); assert.equal(select.value, turnId); assert.equal(editor.value, '中文草稿');
  editor.listeners.compositionend(); assert.equal(select.value, other); assert.equal(editor.value, 'second');
  select.value = turnId; select.listeners.change(); h.advance(); assert.equal(select.value, turnId); assert.equal(editor.value, '中文草稿');
});

test('late native layout changes settle to the correct reading turn and manual selection cancels queued following', () => {
  const h = harness(); h.enableFollow(); h.control().accept({ threadId, notes: { [other]: { text: 'second' } }, acknowledged: [] });
  const select = h.node('select');
  h.scrollTo(turnId); h.settleAt(other); assert.equal(select.value, other);
  h.scrollTo(other); select.value = turnId; select.listeners.change(); h.settleAt(other);
  assert.equal(select.value, turnId);
});
