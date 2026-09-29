import test from 'node:test';
import assert from 'node:assert/strict';
import { installTerminalWheel } from '../public/features/terminal/wheel.js';

function fake({ tracking = 'any' } = {}) {
  const reports = [], frames = [];
  let handler;
  const terminal = {
    rows: 30, cols: 100, modes: { mouseTrackingMode: tracking },
    element: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }) }) }, // 15px rows
    attachCustomWheelEventHandler(fn) { handler = fn; },
    _core: { coreMouseService: { triggerMouseEvent: event => reports.push(event) } }
  };
  const wheel = installTerminalWheel(terminal, { requestFrame: fn => frames.push(fn), cancelFrame() {} });
  const scroll = (deltaY, extra = {}) => handler({ deltaY, deltaMode: 0, clientX: 405, clientY: 100, preventDefault() {}, ...extra });
  const frame = () => { const run = frames.splice(0); run.forEach(fn => fn()); };
  return { wheel, scroll, frame, reports, frames };
}

test('trackpad pixels become one wheel report per text row, batched per frame', () => {
  const f = fake();
  for (let i = 0; i < 5; i++) assert.equal(f.scroll(-6), false, 'xterm default handling is replaced');
  assert.equal(f.frames.length, 1, 'one frame is scheduled for the burst');
  f.frame();
  assert.equal(f.reports.length, 2, '30px over 15px rows is two rows, no 30% damping');
  assert.deepEqual({ ...f.reports[0] }, { col: 50, row: 6, x: 405, y: 100, button: 4, action: 0, ctrl: undefined, alt: undefined, shift: false });
  f.scroll(-7); f.frame(); assert.equal(f.reports.length, 2, 'a partial row waits for more movement');
  f.scroll(-8); f.frame(); assert.equal(f.reports.length, 3, 'accumulated distance completes the row');
});

test('a fast flick sends every row instead of one, capped per frame and continued next frame', () => {
  const f = fake();
  f.scroll(600); // 40 rows down
  f.frame(); assert.equal(f.reports.length, 24); assert.ok(f.reports.every(r => r.action === 1));
  assert.equal(f.frames.length, 1, 'the rest continues on the next frame');
  f.frame(); assert.equal(f.reports.length, 40);
});

test('reversing direction drops the unfinished row, and line or page deltas are honored', () => {
  const f = fake();
  f.scroll(10); f.scroll(-20); f.frame();
  assert.equal(f.reports.length, 1); assert.equal(f.reports[0].action, 0);
  f.scroll(3, { deltaMode: 1 }); f.frame(); assert.equal(f.reports.length, 4);
  f.scroll(1, { deltaMode: 2 }); f.frame(); f.frame(); assert.equal(f.reports.length, 34);
});

test('without mouse tracking, shift or horizontal scrolling, and after dispose, xterm keeps its own handling', () => {
  assert.equal(fake({ tracking: 'none' }).scroll(-30), true);
  const f = fake();
  assert.equal(f.scroll(-30, { shiftKey: true }), true);
  assert.equal(f.scroll(0), true);
  f.wheel.dispose(); assert.equal(f.scroll(-30), true);
  assert.equal(installTerminalWheel({ attachCustomWheelEventHandler() {} }, { requestFrame() {} }).dispose(), undefined, 'no core mouse service means no override');
});
