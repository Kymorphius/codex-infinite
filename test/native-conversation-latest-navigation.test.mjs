import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeLatestNavigation } from '../src/native-conversation-latest-navigation.mjs';

function fixture({ reversed = true } = {}) {
  let time = 0, mounted = 'old', hasTurns = false, tick = null;
  const listeners = new Map();
  const scroll = { scrollTop: 0, scrollHeight: 720, clientHeight: 720, classList: { contains: () => reversed } };
  const content = { closest: () => scroll, querySelector: () => hasTurns ? {} : null };
  const documentRef = {
    querySelectorAll: () => [{ getAttribute: () => mounted }],
    querySelector: selector => selector.includes('navigation-content') ? content : null,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const windowRef = {
    performance: { now: () => time },
    setInterval(callback) { tick = callback; return 1; },
    clearInterval() { tick = null; },
    getComputedStyle: () => ({ flexDirection: reversed ? 'column-reverse' : 'column' })
  };
  const navigation = createNativeLatestNavigation(documentRef, windowRef);
  return { navigation, scroll, listeners, set({ at, route, turns, top, height, runTick = true }) {
    if (at !== undefined) time = at;
    if (route !== undefined) mounted = route;
    if (turns !== undefined) hasTurns = turns;
    if (top !== undefined) scroll.scrollTop = top;
    if (height !== undefined) scroll.scrollHeight = height;
    if (runTick) tick?.();
  }, intent(type) { listeners.get(type)?.(); }, nativeScroll() { listeners.get('scroll')?.({ target: scroll }); } };
}

test('late native scroll restoration is corrected as soon as the target scrolls', () => {
  const f = fixture();
  assert.equal(f.navigation.request('target'), true);
  f.set({ at: 500, route: 'target' });
  f.set({ at: 900, turns: true, top: -26, height: 7085 });
  f.set({ at: 1500, top: -4077, runTick: false });
  assert.equal(f.scroll.scrollTop, -4077);
  f.listeners.get('scroll')?.({ target: {} });
  assert.equal(f.scroll.scrollTop, -4077, 'unrelated scroll events do not touch the timeline');
  f.nativeScroll();
  assert.equal(f.scroll.scrollTop, 0);
  f.set({ at: 2050, top: -1200, runTick: false });
  f.nativeScroll();
  assert.equal(f.scroll.scrollTop, 0, 'a second late native restoration is also boundedly corrected');
  f.set({ at: 4600 });
  assert.deepEqual(f.navigation.snapshot(), { pendingId: '', active: false });
});

test('user input cancels navigation and leaves intentional old-position reading untouched', () => {
  for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    const f = fixture();
    f.navigation.request('target');
    f.intent(type);
    f.set({ at: 1800, route: 'target', turns: true, top: -4077, height: 7085 });
    assert.equal(f.scroll.scrollTop, -4077, type);
    assert.equal(f.navigation.snapshot().active, false);
  }
});

test('same-thread requests, superseded routes and normal timelines keep their boundaries', () => {
  const f = fixture({ reversed: false });
  assert.equal(f.navigation.request('old'), false);
  f.navigation.request('first');
  f.navigation.request('second');
  f.set({ at: 1600, route: 'first', turns: true, top: 100, height: 2000 });
  assert.equal(f.scroll.scrollTop, 100);
  f.set({ at: 2000, route: 'second' });
  f.set({ at: 2310 });
  assert.equal(f.scroll.scrollTop, 1280);
  f.set({ at: 2500, route: 'elsewhere' });
  assert.equal(f.navigation.snapshot().active, false);
});
