import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createClaudeMirrorTurns } from '../src/claude-mirror-turn.mjs';

const target = '11111111-1111-4111-8111-111111111111';
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
function fakeSpawn(runs) {
  return (shell, args, options) => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    const run = { shell, args, options, input: '', child, finish(code = 0, stderr = '') { if (stderr) child.stderr.emit('data', stderr); child.emit('close', code); } };
    child.stdin = { end(text) { run.input = text; } };
    runs.push(run); return child;
  };
}

test('a mirror message waits for Codex, runs one resumed one-shot turn, then clears its state', async () => {
  const runs = []; let holders = [{ pid: 7, codexTurn: true }];
  const turns = createClaudeMirrorTurns({ userHome: '/home/u', holders: async () => holders, spawn: fakeSpawn(runs), pollMs: 5, shell: '/bin/zsh' });
  assert.equal(turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: 'hi' }).state, 'waiting');
  await settle();
  assert.equal(runs.length, 0, 'waits while Codex holds the session');
  holders = [];
  await settle();
  assert.equal(runs.length, 1); assert.equal(turns.state('r').state, 'running');
  assert.deepEqual(runs[0].args, ['-lc', `command claude -p --resume ${target} --permission-mode bypassPermissions`]);
  assert.equal(runs[0].input, 'hi'); assert.equal(runs[0].options.cwd, '/w');
  runs[0].finish(0); await settle();
  assert.equal(turns.state('r'), null);
});

test('messages for one conversation run one at a time; failures and interactive holders are reported', async () => {
  const runs = []; let holders = [];
  const turns = createClaudeMirrorTurns({ userHome: '/home/u', holders: async () => holders, spawn: fakeSpawn(runs), pollMs: 5 });
  turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: 'one' });
  turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: 'two' });
  await settle();
  assert.equal(runs.length, 1, 'the second waits for the first');
  runs[0].finish(1, 'line one\nrate limited'); await settle();
  assert.equal(runs.length, 2);
  runs[1].finish(0); await settle();
  holders = [{ pid: 9 }];
  turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: 'three' }); await settle();
  assert.equal(turns.state('r').state, 'failed'); assert.match(turns.state('r').error, /进程 9/);
  assert.equal(runs.length, 2);
  assert.throws(() => turns.send({ id: 'r', ids: [target], target: 'bad', cwd: '/w', text: 'x' }), /会话标识/);
  assert.throws(() => turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: '  ' }), /为空/);
});

test('a failed one-shot keeps its error for the mirror', async () => {
  const runs = [];
  const turns = createClaudeMirrorTurns({ userHome: '/home/u', holders: async () => [], spawn: fakeSpawn(runs), pollMs: 5 });
  turns.send({ id: 'r', ids: [target], target, cwd: '/w', text: 'x' }); await settle();
  runs[0].finish(2, 'auth expired'); await settle();
  assert.deepEqual([turns.state('r').state, /auth expired/.test(turns.state('r').error)], ['failed', true]);
});
