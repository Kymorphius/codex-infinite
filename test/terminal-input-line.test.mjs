import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalInputLine, cleanTerminalInputLine } from '../src/terminal-input-line.mjs';
import { TerminalService } from '../src/terminal-service.mjs';

const run = (...frames) => frames.reduce((line, frame) => terminalInputLine(line, frame, 5), cleanTerminalInputLine()).dirty;

test('the input line is clean only after Enter or Ctrl-C ends the input', () => {
  const step = data => run(data);
  assert.equal(step('ls'), true); assert.equal(step('ls\r'), false); assert.equal(step('\x1b[200~text\x1b[201~'), true);
  assert.equal(step('\x1b[200~a\rb\x1b[201~'), true, 'an Enter inside a paste does not end it');
  assert.equal(step('\x1b[200~a\r\x1b[201~'), true);
  assert.equal(step('\x1b[200~multi\nline\x1b[201~\r'), false, 'the composer\'s paste + Enter submits');
  assert.equal(step('draft\x03'), false, 'Ctrl-C clears Claude\'s prompt');
  assert.equal(run('draft', '\x18\x13'), false, '⌘Enter (send now) submits');
  assert.equal(step('\x1b[A'), true, 'history recall fills the line'); assert.equal(step('\x1b'), true);
  assert.equal(run('\x1b[A', '\r'), false, 'Enter after a recalled line submits it');
  assert.equal(run('abc', '\x7f\x7f\x7f'), true, 'deleting is still conservatively dirty');
  const dirty = terminalInputLine(cleanTerminalInputLine(), 'x', 1);
  assert.equal(terminalInputLine(dirty, '\x1b[I\x1b[O\x1b[<0;10;5M\x1b]11;rgb:1818/1818/1818\x07\x1b[12;40R', 9), dirty, 'focus, mouse and query replies are ignored');
  assert.deepEqual(terminalInputLine(cleanTerminalInputLine(), '\x1b[I', 9), cleanTerminalInputLine());
  const submitted = terminalInputLine(dirty, '\r', 7);
  assert.deepEqual([submitted.dirty, submitted.at, submitted.seq], [false, 7, 2]);
});

test('Enters that only add a line or accept a suggestion keep the draft dirty', () => {
  assert.equal(run('refactor this\\', '\r'), true, 'backslash + Enter continues the prompt');
  assert.equal(run('refactor this\\\r'), true);
  assert.equal(run('fix the parser', '\x1b\r'), true, 'Option/Meta + Enter inserts a newline');
  assert.equal(run('x\x1b\r'), true);
  assert.equal(run('fix', '\x1b', '\r'), true, 'ESC then Enter in separate frames');
  assert.equal(run('look at @src/fo', '\r'), true, 'Enter accepts the @file suggestion');
  assert.equal(run('look at @src/fo', '\r', '\r'), false, 'the next Enter submits');
  assert.equal(run('mail me@example.com\r'), false, 'an @ inside a word is not a mention');
  assert.equal(run('line one\\', '\r', 'line two', '\r'), false, 'a continued prompt is clean once submitted');
});

test('terminal replies to queries never dirty the line', () => {
  for (const reply of ['\x1b[>0;276;0c', '\x1b[?1;2c', '\x1b[=1c', '\x1b[?2026;2$y', '\x1b[12;2$y', '\x1b[?1u', '\x1b[0n']) {
    assert.equal(run(reply), false, JSON.stringify(reply));
  }
  assert.equal(run('\x1b[13;2u'), true, 'a kitty-protocol key (Shift+Enter) is input, not a reply');
});

test('TerminalService tracks client and server input on the line', async t => {
  let time = 100; const written = [];
  const service = new TerminalService({ userHome: '/tmp', defaultCwd: '/tmp', validateCwd: async cwd => cwd, now: () => time,
    spawnProcess: async () => ({ write: data => written.push(data), resize() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {} }) });
  t.after(() => service.dispose());
  const session = await service.create({ kind: 'claude' });
  assert.deepEqual(service.inputLine(session.id), { dirty: false, at: 0, seq: 0 });
  const connection = service.connect(session.id, { send() {}, close() {} });
  connection.receive({ type: 'input', data: 'half typed' });
  assert.deepEqual(service.inputLine(session.id), { dirty: true, at: 100, seq: 1 });
  time = 200; assert.deepEqual(service.write(session.id, '\r'), { dirty: false, at: 200, seq: 2 }, 'a write returns the line it left');
  assert.deepEqual(service.inputLine(session.id), { dirty: false, at: 200, seq: 2 }); assert.deepEqual(written, ['half typed', '\r']);
});
