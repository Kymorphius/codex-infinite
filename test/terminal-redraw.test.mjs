import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalService } from '../src/terminal-service.mjs';
import { terminalClientFrame } from '../src/terminal-contract.mjs';
import { createTerminalSession } from '../public/features/terminal/session.js';

test('Claude repaint keeps PTY and display widths aligned and restores interrupted pulses', async () => {
  assert.deepEqual(terminalClientFrame({ type: 'redraw' }), { type: 'redraw' });
  assert.throws(() => terminalClientFrame({ type: 'redraw', data: '\f' }), { statusCode: 400 });
  const timers = [], sizes = [], writes = [], frames = [], callbacks = {};
  const pty = {
    resize: (cols, rows) => sizes.push([cols, rows]), write: data => writes.push(data),
    onData: callback => { callbacks.data = callback; return { dispose() {} }; },
    onExit: callback => { callbacks.exit = callback; return { dispose() {} }; },
    kill: async () => {}
  };
  const service = new TerminalService({ defaultCwd: '/project', validateCwd: async () => {}, spawnProcess: async () => pty,
    schedule: callback => { const timer = { callback, cancelled: false }; timers.push(timer); return timer; },
    cancel: timer => { if (timer) timer.cancelled = true; } });
  const session = await service.create({ kind: 'claude', cols: 100, rows: 30 });
  let connection = service.connect(session.id, { send: frame => frames.push(frame), close() {} });
  connection.receive({ type: 'redraw' }); connection.receive({ type: 'redraw' });
  for (let index = 0; index < 4; index++) timers[index].callback();
  assert.deepEqual(sizes, [[99, 30], [100, 30], [99, 30], [100, 30]]);
  assert.deepEqual(frames.filter(frame => frame.type === 'redraw-size').map(({ cols, rows }) => [cols, rows]), sizes);
  assert.deepEqual(writes, [], 'repaint never injects terminal input');
  assert.equal(frames.filter(frame => frame.type === 'ready').length, 1);
  connection.receive({ type: 'redraw' });
  connection.receive({ type: 'resize', cols: 120, rows: 40 });
  timers.at(-1).callback();
  assert.deepEqual(sizes.slice(-2), [[99, 30], [120, 40]], 'real layout resize wins');
  connection.receive({ type: 'redraw' }); connection.detach();
  assert.deepEqual(sizes.slice(-2), [[119, 40], [120, 40]], 'disconnect restores the PTY');
  assert.equal(timers.at(-1).cancelled, true);
  connection = service.connect(session.id, { send: frame => frames.push(frame), close() {} });
  connection.receive({ type: 'redraw' }); callbacks.exit({ exitCode: 0 });
  assert.deepEqual(frames.slice(-2).map(frame => frame.type), ['redraw-size', 'exit']);
  assert.deepEqual(sizes.slice(-2), [[119, 40], [120, 40]], 'exit restores the PTY');
  await service.dispose();
});

test('redraw size frames follow parsed output and never echo a resize to the PTY', () => {
  const sockets = [], displays = [];
  class Terminal {
    constructor(options) { this.options = options; this.callbacks = []; displays.push(this); }
    loadAddon() {} open() {} focus() {} dispose() {} reset() {}
    onData() { return { dispose() {} }; }
    resize(cols, rows) { this.cols = cols; this.rows = rows; }
    refresh(start, end) { this.refreshed = [start, end]; }
    write(data, callback) { this.callbacks.push(callback); }
  }
  class Socket {
    constructor() { this.readyState = 1; this.sent = []; sockets.push(this); }
    send(payload) { this.sent.push(JSON.parse(payload)); }
    receive(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
    close() { this.readyState = 3; }
  }
  const session = { id: 'redraw', kind: 'claude', status: 'running', cols: 80, rows: 24 };
  const view = createTerminalSession(session, {
    host: { hidden: false, getBoundingClientRect: () => ({ width: 800, height: 500 }), remove() {} },
    TerminalCtor: Terminal, FitAddonCtor: class { fit() {} }, WebSocketCtor: Socket,
    ResizeObserverCtor: class { observe() {} disconnect() {} },
    locationRef: { href: 'http://127.0.0.1/', protocol: 'http:' }
  });
  view.activate();
  const socket = sockets[0], display = displays[0];
  socket.receive({ type: 'ready', session, replay: 'before' }); display.callbacks.shift()();
  const sent = socket.sent.length;
  socket.receive({ type: 'data', data: 'old-width' });
  socket.receive({ type: 'redraw-size', cols: 79, rows: 24 });
  socket.receive({ type: 'data', data: 'new-width' });
  assert.equal(display.cols, 80);
  display.callbacks.shift()(); assert.equal(display.cols, 80);
  display.callbacks.shift()(); assert.equal(display.cols, 79);
  assert.deepEqual(display.refreshed, [0, 23]);
  socket.receive({ type: 'redraw-size', cols: 80, rows: 24 });
  display.callbacks.shift()(); display.callbacks.shift()();
  assert.equal(display.cols, 80);
  assert.equal(socket.sent.length, sent);
  view.dispose();
});
