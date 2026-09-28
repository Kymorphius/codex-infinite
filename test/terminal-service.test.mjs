import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TerminalService } from '../src/terminal-service.mjs';
import { TERMINAL_LIMITS, terminalClientFrame } from '../src/terminal-contract.mjs';
import { terminalEnvironment, terminalLaunch, validateTerminalCwd, killTerminalProcess } from '../src/terminal-process.mjs';

function fixture(options = {}) {
  const processes = [], calls = [];
  const service = new TerminalService({ userHome: '/real/home', defaultCwd: '/project', validateCwd: async () => {},
    spawnProcess: async input => {
      const listeners = {};
      const pty = { input, writes: [], sizes: [], killed: 0,
        onData: listener => { listeners.data = listener; return { dispose: () => delete listeners.data }; },
        onExit: listener => { listeners.exit = listener; return { dispose: () => delete listeners.exit }; },
        write: data => pty.writes.push(data), resize: (...size) => pty.sizes.push(size),
        kill: async () => { pty.killed++; },
        output: data => listeners.data?.(data), exit: exitCode => listeners.exit?.({ exitCode }) };
      processes.push(pty); calls.push(input); return pty;
    }, ...options });
  const connect = id => {
    const frames = [], closes = [];
    const connection = service.connect(id, { send: frame => frames.push(frame), close: (...args) => closes.push(args) });
    return { ...connection, frames, closes };
  };
  return { service, processes, calls, connect };
}

test('terminal reconnect replays output without respawn and replaces one writer', async () => {
  const { service, processes, calls, connect } = fixture();
  const session = await service.create({ kind: 'claude', cwd: '/work', cols: 100, rows: 30 });
  assert.deepEqual(calls, [{ kind: 'claude', cwd: '/work', cols: 100, rows: 30, userHome: '/real/home' }]);
  processes[0].output('你好\r\n');
  const first = connect(session.id);
  assert.equal(first.frames[0].replay, '你好\r\n');
  first.receive({ type: 'input', data: '中文\x03' });
  first.receive({ type: 'resize', cols: 120, rows: 40 });
  const second = connect(session.id);
  assert.equal(first.closes[0][0], 4001);
  assert.throws(() => first.receive({ type: 'input', data: 'stale' }), { statusCode: 409 });
  first.detach(); second.receive({ type: 'input', data: 'current' });
  assert.deepEqual(processes[0].writes, ['中文\x03', 'current']);
  assert.deepEqual(processes[0].sizes, [[120, 40]]);
  second.detach(); processes[0].output('offline');
  assert.equal(processes[0].killed, 0); assert.equal(calls.length, 1);
  assert.equal(connect(session.id).frames[0].replay, '你好\r\noffline');
  assert.equal(service.list().sessions[0].cols, 120);
  await service.dispose(); assert.equal(processes[0].killed, 1);
});

test('terminal bounded UTF-8 replay reports truncation and reconnects exited sessions', async () => {
  const { service, processes, connect } = fixture({ replayBytes: 8 });
  const session = await service.create({});
  processes[0].output('前缀你好世界');
  const ready = connect(session.id).frames[0];
  assert.equal(ready.session.replayTruncated, true);
  assert.ok(Buffer.byteLength(ready.replay) <= 8); assert.equal(ready.replay, '世界');
  const active = connect(session.id); processes[0].exit(7);
  assert.deepEqual(active.frames.at(-1), { type: 'exit', exitCode: 7 });
  const exited = connect(session.id);
  assert.equal(exited.frames[0].session.status, 'exited');
  assert.equal(exited.frames[0].session.exitCode, 7);
  assert.throws(() => exited.receive({ type: 'input', data: '\r' }), { statusCode: 409 });
  await service.close(session.id);
  assert.equal(processes[0].killed, 0); assert.equal(service.list().sessions.length, 0);
  assert.throws(() => service.connect(session.id, {}), { statusCode: 404 });
});

test('control-heavy replay stays within the serialized socket queue bound', async () => {
  const { service, processes, connect } = fixture();
  const session = await service.create({});
  processes[0].output('\0'.repeat(TERMINAL_LIMITS.replayBytes));
  const ready = connect(session.id).frames[0];
  assert.ok(Buffer.byteLength(JSON.stringify(ready)) <= TERMINAL_LIMITS.bufferedBytes);
  assert.equal(ready.session.replayTruncated, true);
  assert.equal(service.list().sessions[0].replayTruncated, true);
  await service.dispose();
});

test('terminal creation bounds concurrent pending and retained sessions, and frees failed capacity', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { service } = fixture({ validateCwd: () => gate });
  const creates = Array.from({ length: TERMINAL_LIMITS.sessions }, () => service.create({}));
  await assert.rejects(service.create({}), { statusCode: 429 });
  release(); await Promise.all(creates);
  await assert.rejects(service.create({}), { statusCode: 429 });
  await service.close(service.list().sessions[0].id); await service.create({});
  await service.dispose(); assert.equal(service.list().sessions.length, 0);
  await assert.rejects(service.create({}), { statusCode: 503 });
  const failed = fixture({ spawnProcess: async () => { throw Error('spawn failed'); } }).service;
  await assert.rejects(failed.create({}), /spawn failed/); assert.equal(failed.pending, 0);
});

test('shutdown during pending spawn kills the new process and publishes no session', async () => {
  let release, started, killed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const spawnStarted = new Promise(resolve => { started = resolve; });
  const { service } = fixture({ spawnProcess: async () => { started(); await gate; return { kill: async () => { killed++; } }; } });
  const create = service.create({});
  await spawnStarted;
  const disposal = service.dispose(); release();
  await assert.rejects(create, { statusCode: 503 });
  await disposal;
  assert.equal(killed, 1); assert.equal(service.list().sessions.length, 0);
});

test('slow transport detaches without killing PTY and explicit close removes owned process', async () => {
  const { service, processes, connect } = fixture();
  const session = await service.create({}), closes = [];
  service.connect(session.id, { send: () => { throw Error('buffer full'); }, close: code => closes.push(code) });
  assert.deepEqual(closes, [4002]); assert.equal(processes[0].killed, 0);
  processes[0].output('still running');
  const current = connect(session.id);
  assert.equal(current.frames[0].replay, 'still running');
  await service.close(session.id);
  assert.equal(current.closes[0][0], 4000); assert.equal(processes[0].killed, 1);
  assert.throws(() => current.receive({ type: 'input', data: 'no' }), { statusCode: 409 });
});

test('terminal accepts only bounded contracts and validates existing absolute directories', async t => {
  const { service, calls } = fixture();
  for (const input of [null, [], { kind: 'arbitrary' }, { cwd: '' }, { cwd: '/a\ncommand' },
    { env: {} }, { shell: '/bin/other' }, { cols: 0 }, { rows: 301 }, { cols: '80' }]) {
    await assert.rejects(service.create(input), { statusCode: 400 });
  }
  assert.equal(calls.length, 0);
  for (const frame of [{ type: 'input', data: '字'.repeat(30000) }, { type: 'input', data: 1 },
    { type: 'resize', cols: 90, rows: 30, env: {} }, { type: 'unknown' }]) {
    assert.throws(() => terminalClientFrame(frame), { statusCode: 400 });
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-cwd-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'file'), 'x');
  assert.equal(await validateTerminalCwd(directory), directory);
  for (const value of ['relative/path', path.join(directory, 'missing'), path.join(directory, 'file')]) {
    await assert.rejects(validateTerminalCwd(value), { statusCode: 400 });
  }
});

test('process adapter preserves real HOME but strips infrastructure and provider credentials', () => {
  const env = terminalEnvironment({ userHome: '/real/user', shell: '/bin/zsh', env: {
    HOME: '/internal/profile', PATH: '/bin', LANG: 'zh_CN.UTF-8', TERM: 'wrong',
    ANTHROPIC_API_KEY: 'secret', CODEX_HOME: '/private/codex', CLAUDE_CONFIG_DIR: '/harness',
    SSH_AUTH_SOCK: '/private/agent', NODE_OPTIONS: '--require=secret', NODE_AUTH_TOKEN: 'secret' } });
  assert.equal(env.HOME, '/real/user'); assert.equal(env.PATH, '/bin'); assert.equal(env.TERM, 'xterm-256color');
  for (const key of ['ANTHROPIC_API_KEY', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'SSH_AUTH_SOCK', 'NODE_OPTIONS', 'NODE_AUTH_TOKEN']) assert.equal(env[key], undefined);
  const claude = terminalLaunch({ kind: 'claude', platform: 'darwin', env: { SHELL: '/bin/zsh' } });
  assert.equal(claude.shell, '/bin/zsh'); assert.match(claude.args[1], /^claude --append-system-prompt '/u);
  assert.match(claude.args[1], /ccc-ui:split=open/u); assert.match(claude.args[1], /ccc-ui:redraw/u);
  assert.deepEqual(terminalLaunch({ kind: 'shell', platform: 'linux', env: { SHELL: 'injected args' } }), { shell: '/bin/bash', args: ['-l'] });
  assert.deepEqual(terminalLaunch({ kind: 'claude', attachJob: '13649afa', platform: 'darwin', env: { SHELL: '/bin/zsh' } }), { shell: '/bin/zsh', args: ['-lic', 'claude attach 13649afa'] });
  assert.throws(() => terminalLaunch({ kind: 'claude', attachJob: '13649afa; rm -rf ~', platform: 'darwin', env: {} }), { statusCode: 400 });
});

test('process cleanup targets only owned PTY group and its attached descendants, never detached daemons', async () => {
  const killed = [], root = process.pid + 10000;
  // root+4 is a daemon that detached from the terminal (no tty); it and its child survive.
  const stdout = `${root} 1 ttys017\n${root + 1} ${root} ttys017\n${root + 2} ${root + 1} ttys017\n${root + 3} 1 ttys002\n${process.pid} 1 ??\n${root + 4} ${root + 1} ??\n${root + 5} ${root + 4} ttys018\n`;
  const pty = { pid: root, kill: signal => killed.push(['pty', signal]) };
  await killTerminalProcess(pty, { platform: 'darwin', executeCommand: async () => ({ stdout }), kill: (...args) => killed.push(args) });
  assert.deepEqual(killed, [[-root, 'SIGHUP'], [root + 2, 'SIGKILL'], [root + 1, 'SIGKILL'], ['pty', 'SIGKILL']]);
  await killTerminalProcess({ pid: process.pid, kill: () => assert.fail('own process') });
  await killTerminalProcess({ pid: 0, kill: () => assert.fail('process group zero') });
});
