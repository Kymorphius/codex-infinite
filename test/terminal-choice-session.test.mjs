import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerminalSession } from '../public/features/terminal/session.js';

test('the Claude choice mirror follows parsed PTY output and clears on disconnect', () => {
  let terminal, socket;
  class Terminal {
    constructor() { terminal = this; this.options = {}; this.callbacks = []; }
    loadAddon() {} open() {} focus() {} reset() {} resize() { this.rows = 24; this.cols = 80; }
    onData() { return { dispose() {} }; }
    write(_data, callback) { this.callbacks.push(callback); }
    dispose() {}
  }
  class Socket {
    constructor() { socket = this; this.readyState = 1; }
    send() {} close() { this.readyState = 2; }
    receive(frame) { this.onmessage({ data: JSON.stringify(frame) }); }
  }
  const session = { id: 'claude', kind: 'claude', status: 'running', cols: 80, rows: 24 };
  const view = createTerminalSession(session, {
    host: { getBoundingClientRect: () => ({ width: 600, height: 400 }), remove() {} },
    TerminalCtor: Terminal, FitAddonCtor: class { fit() {} }, WebSocketCtor: Socket,
    ResizeObserverCtor: class { observe() {} disconnect() {} },
    locationRef: { href: 'http://127.0.0.1/', protocol: 'http:' }
  });
  view.activate();
  const lines = ['Choose a plan?', '❯ 1. Keep', '  2. Replace'];
  terminal.buffer = { active: { length: lines.length, viewportY: 0,
    getLine: row => ({ translateToString: () => lines[row] }) } };
  socket.receive({ type: 'ready', session, replay: 'menu' });
  assert.equal(view.snapshot().choicePrompt, null, 'replay has not finished parsing');
  terminal.callbacks.shift()();
  assert.equal(view.snapshot().choicePrompt?.question, 'Choose a plan?');
  lines.splice(0, lines.length, 'Claude is working'); terminal.buffer.active.length = 1;
  socket.receive({ type: 'data', data: 'done' }); terminal.callbacks.shift()();
  assert.equal(view.snapshot().choicePrompt, null, 'disappearing menu clears the dock');
  socket.onclose({ code: 4001 }); assert.equal(view.snapshot().choicePrompt, null);
  view.dispose();
});
