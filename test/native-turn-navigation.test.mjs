import { selectAnnotationReadingTurn, readAnnotationReadingTurn } from '../src/annotation-reading-turn.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTurnNavigation } from '../src/native-turn-navigation.mjs';
import { readNativeTurnPreview } from '../src/native-turn-rail-preview.mjs';
import { buildNativeTurnAnnotationsScript } from '../src/native-turn-annotations.mjs';
const turnId = '01a06856-63e5-7a13-a3a9-90bbf2138fdc';
test('turn preview combines messages once, loads through the native reader and preserves text safely', () => {
  const requests = [];
  const items = ['first', 'second'].map((name, i) => ({ id: turnId + ':' + i, getLabel: () => name + '<script>', getPreview: () => ({ response: 'same response' }) }));
  const marker = { __reactFiberTest: { memoizedProps: { items, onPreviewItem: item => requests.push(item.id) } } };
  const result = readNativeTurnPreview({ id: turnId, markers: [marker] }, true);
  assert.equal(result.prompt, 'first<script>\nsecond<script>'); assert.equal(result.response, 'same response'); assert.equal(requests.length, 2);
  const unavailable = readNativeTurnPreview({ id: turnId, markers: [] }); assert.equal(unavailable.prompt, '');
  assert.doesNotThrow(() => new Function(buildNativeTurnAnnotationsScript()));
});
function harness() {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.style = { getPropertyValue(k) { return this[k] || ''; }, setProperty(k,v) { this[k] = v; }, removeProperty(k) { delete this[k]; } }; }
    append(...nodes) { nodes.forEach(n => { this.children.push(n); n.parentElement = this; }); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(k,v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    hasAttribute(k) { return k in this.attrs; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k,fn) { this.listeners[k] = fn; }
    removeEventListener() {}
    contains(n) { return n === this || this.children.some(x => x.contains(n)); }
    closest(selector) { if (selector === 'nav') return this.nativeNav; return this.hasAttribute('data-ccc-turn-marker') ? this : null; }
    getBoundingClientRect() { return { left: 300, right: 336, top: 300, bottom: 312, width: 36, height: 12 }; }
    remove() { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); }
  }
  const body = new Node('body'), head = new Node('head'), nav = new Node('nav'), parent = new Node('div'), host = new Node('div');
  parent.getBoundingClientRect = () => ({ right: 1400 }); parent.append(nav); body.append(parent);
  host.getBoundingClientRect = () => ({ left: 280, top: 50, width: 1120, height: 800 });
  let clicks = 0, selected = '', note = 'my note';
  const marker = new Node('button'); marker.nativeNav = nav; marker.click = () => clicks++; marker.setAttribute('aria-current', 'true'); nav.append(marker);
  const document = { body, head, createElement: tag => new Node(tag), addEventListener() {}, removeEventListener() {} };
  const controller = createNativeTurnNavigation({ getReadingTurn: context => readAnnotationReadingTurn(context, selectAnnotationReadingTurn), document, window: { innerWidth: 1400, innerHeight: 900 }, getNote: () => note, selectTurn: id => selected = id, readPreview: () => ({ prompt: 'prompt', response: 'response' }) });
  const context = { threadId: 'thread', host, turns: [{ id: turnId, markers: [marker] }] }, output = { getBoundingClientRect: () => ({ left: 1080, width: 300 }) };
  controller.update(context, output);
  const rail = body.children.find(x => x.hasAttribute('data-ccc-turn-rail')), popup = body.children.find(x => x.hasAttribute('data-ccc-turn-rail-preview'));
  return { controller, context, output, nav, rail, popup, body, clicks: () => clicks, selected: () => selected, clearNote: () => { note = ''; } };
}
test('left turn ticks jump/select, show summary and note cards; native message rail moves right before the output column', () => {
  const h = harness(), button = h.rail.children[0];
  assert.equal(h.rail.style.left, '292px'); assert.equal(h.nav.style.getPropertyValue('--ccc-message-rail-inset'), '328px');
  assert.equal(button.getAttribute('aria-current'), 'true'); assert.ok(button.hasAttribute('data-annotated'));
  h.rail.listeners.pointerover({ target: button }); assert.equal(h.popup.hidden, false); assert.equal(h.popup.children[1].hidden, false);
  assert.equal(h.popup.children[0].className, h.popup.children[1].className);
  h.rail.listeners.click({ target: button }); assert.equal(h.clicks(), 1); assert.equal(h.selected(), turnId);
  h.clearNote(); h.controller.update(h.context, h.output); assert.equal(h.popup.children[1].hidden, true); assert.equal(h.rail.children[0], button);
  h.controller.update(null, null); assert.equal(h.rail.hidden, true); assert.equal(h.nav.hasAttribute('data-ccc-message-rail-right'), false);
  h.controller.dispose(); assert.equal(h.body.children.length, 1);
});

test('multiple native current message markers produce exactly one current turn using the reading position', () => {
  const h = harness(), first = h.context.turns[0], second = { ...first, id: 'second' };
  first.anchor = { getBoundingClientRect: () => ({ top: -200, bottom: 200 }) };
  second.anchor = { getBoundingClientRect: () => ({ top: 200, bottom: 900 }) };
  h.context.content = { closest: () => ({ getBoundingClientRect: () => ({ left: 280, right: 1400, top: 50, bottom: 850, width: 1120, height: 800 }) }) };
  h.context.turns.push(second); h.controller.update(h.context, h.output);
  const active = () => h.rail.children.filter(n => n.getAttribute('aria-current') === 'true');
  assert.equal(active().length, 1); assert.equal(active()[0].getAttribute('data-ccc-turn-marker'), 'second');
  first.anchor = null; second.anchor = null; h.controller.update(h.context, h.output);
  assert.equal(active().length, 1, 'native fallback must also select one turn');
});

test('overview rail keeps a fixed large window, slides only near its edge and preserves endpoints', () => {
  const h = harness(), marker = h.context.turns[0].markers[0];
  h.context.turns = Array.from({ length: 200 }, (_, i) => ({ id: 'turn-' + i, markers: i === 199 ? [marker] : [] }));
  h.controller.update(h.context, h.output);
  assert.equal(h.rail.style.height, '600px');
  assert.equal(h.rail.scrollTop, 1400);
  assert.equal(h.rail.style.getPropertyValue('--ccc-rail-fade-top'), 'transparent');
  assert.equal(h.rail.style.getPropertyValue('--ccc-rail-fade-bottom'), 'black');
  h.context.turns[199].markers = []; h.context.turns[160].markers = [marker];
  h.controller.update(h.context, h.output); assert.equal(h.rail.scrollTop, 1400, 'reading within the window must not recenter');
  h.context.turns[160].markers = [];
  h.context.turns[199].markers = []; h.context.turns[0].markers = [marker];
  h.controller.update(h.context, h.output); assert.equal(h.rail.scrollTop, 0);
  let revealed = false; h.context.turns[1].anchor = { getBoundingClientRect: () => ({ top: -1, bottom: 0 }), scrollIntoView() { revealed = true; } };
  h.rail.listeners.wheel({ deltaY: 30, preventDefault() {}, stopPropagation() {} });
  assert.equal(h.selected(), 'turn-1'); assert.equal(revealed, true);
});
