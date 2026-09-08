import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAnnotationReadingTurn, readAnnotationReadingTurn } from '../src/annotation-reading-turn.mjs';
test('reading geometry follows the upper third with gaps, tall turns and offscreen exclusions', () => {
  const viewport = { top: 100, bottom: 1000 };
  assert.equal(selectAnnotationReadingTurn([{ id: 'first', top: -500, bottom: 500 }, { id: 'second', top: 500, bottom: 1200 }], viewport), 'first');
  assert.equal(selectAnnotationReadingTurn([{ id: 'first', top: -500, bottom: 200 }, { id: 'second', top: 200, bottom: 1200 }], viewport), 'second');
  assert.equal(selectAnnotationReadingTurn([{ id: 'first', top: 120, bottom: 300 }, { id: 'second', top: 450, bottom: 800 }], viewport), 'second');
  assert.equal(selectAnnotationReadingTurn([{ id: 'hidden', top: -400, bottom: 0 }], viewport), null);
  assert.equal(selectAnnotationReadingTurn([], { top: 0, bottom: 0 }), null);
});
test('native current marker is a fallback only when no visible turn anchor can identify the reading position', () => {
  const current = { getAttribute: () => 'true' };
  const context = { content: { closest: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 900 }) }) }, turns: [
    { id: 'stale-marker', markers: [current] }, { id: 'visible', markers: [], anchor: { getBoundingClientRect: () => ({ top: 0, bottom: 700 }) } }
  ] };
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'visible');
  context.turns[1].anchor = null;
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'stale-marker');
});

test('reverse native timeline at its bottom selects the final short turn even below the reading line', () => {
  const scroll = { scrollTop: 1, scrollHeight: 2942, clientHeight: 922, classList: { contains: () => true }, getBoundingClientRect: () => ({ top: 47, bottom: 969 }) };
  const context = { content: { closest: () => scroll }, turns: [
    { id: 'previous', markers: [], anchor: { getBoundingClientRect: () => ({ top: -153, bottom: 381 }) } },
    { id: 'latest', markers: [], anchor: { getBoundingClientRect: () => ({ top: 392, bottom: 810 }) } }
  ] };
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'latest');
  scroll.scrollTop = -300;
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'previous');
  scroll.scrollTop = 0; context.turns[1].anchor = null;
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'latest', 'native tail virtualization must not prevent selecting the final turn');
});
test('normal scroll containers also honor the bottom boundary without forcing the final turn while reading above it', () => {
  const scroll = { scrollTop: 400, scrollHeight: 1000, clientHeight: 600, classList: { contains: () => false }, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) };
  const context = { content: { closest: () => scroll }, turns: [
    { id: 'previous', markers: [], anchor: { getBoundingClientRect: () => ({ top: 0, bottom: 350 }) } },
    { id: 'latest', markers: [], anchor: { getBoundingClientRect: () => ({ top: 360, bottom: 500 }) } }
  ] };
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'latest');
  scroll.scrollTop = 200;
  assert.equal(readAnnotationReadingTurn(context, selectAnnotationReadingTurn), 'previous');
});
