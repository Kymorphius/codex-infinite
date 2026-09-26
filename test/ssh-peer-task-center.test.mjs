import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SshPeerTaskCenter } from '../src/ssh-peer-task-center.mjs';
import { sshTaskCenterArguments, sshActionArguments, TASK_CENTER_ACTION_PATH, TASK_IMAGES_ACTION_PATH } from '../src/ssh-peer-commands.mjs';
import { ACTION_HEADERS, signPeerAction } from '../src/peer-action-auth.mjs';
import { GENERAL_TASK_SCOPE_ID } from '../src/task-center-contract.mjs';

const direct = { type: 'direct-ssh', host: 'win.example', user: 'dev', port: 22, dashboardPort: 47831 };
const relay = { type: 'ssh-relay', relayHost: 'relay.example', relayUser: 'relay', relayPort: 2201, forwardedPort: 48000 };
const action = extra => ({ ownerDeviceId: 'win', scopeId: GENERAL_TASK_SCOPE_ID, id: 'task-one', requestId: 'request-one', expectedRevision: 'a'.repeat(64), type: 'edit', text: "保留图片 😀 $(echo should-not-run) ' quoted", ...extra });
const peer = (platform = 'posix', transports = [direct]) => ({ id: 'win', name: 'Windows', platform, transports });
const psSource = args => Buffer.from(args.at(-1), 'base64').toString('utf16le');

async function keyFile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-task-center-')), file = path.join(directory, 'key'), key = Buffer.alloc(32, 11);
  await fs.writeFile(file, key.toString('base64'), { mode: 0o600 });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { file, key };
}
function fakeSpawn(responses) {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter(), call = { command, args, options, killed: false };
    calls.push(call);
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
    let closed = false;
    const close = code => { if (!closed) { closed = true; child.emit('close', code); } };
    child.kill = () => { call.killed = true; queueMicrotask(() => close(1)); };
    child.stdin.end = body => {
      call.body = Buffer.from(body);
      const response = responses[calls.length - 1] ?? { status: 'ok', applied: true, requestId: 'request-one' };
      queueMicrotask(() => {
        if (response instanceof Error) { child.emit('error', response); close(1); return; }
        child.stderr.emit('data', Buffer.from('private remote diagnostic'));
        child.stdout.emit('data', Buffer.isBuffer(response) ? response : Buffer.from(typeof response === 'string' ? response : JSON.stringify(response)));
        close(0);
      });
    };
    return child;
  };
  return { calls, spawn };
}
function headersFrom(call) {
  if (call.args.includes('powershell.exe')) {
    const source = psSource(call.args);
    return Object.fromEntries(Object.values(ACTION_HEADERS).map(name => [name, source.match(new RegExp(`'${name}'='([^']+)'`))[1]]));
  }
  const values = call.args.filter((value, index) => call.args[index - 1] === '-H' && value.startsWith('x-codex-node-'));
  return Object.fromEntries(values.map(value => { const colon = value.indexOf(':'); return [value.slice(0, colon), value.slice(colon + 1)]; }));
}

test('task snapshots use fixed loopback endpoints with platform-specific commands and strict SSH', () => {
  const posix = sshTaskCenterArguments(direct), windows = sshTaskCenterArguments(direct, { remotePlatform: 'windows' }), relayed = sshTaskCenterArguments(relay, { remotePlatform: 'windows' });
  for (const args of [posix, windows, relayed]) {
    assert.ok(args.includes('BatchMode=yes')); assert.ok(args.includes('StrictHostKeyChecking=yes'));
  }
  assert.ok(posix.includes('/usr/bin/curl')); assert.equal(posix.at(-1), 'http://127.0.0.1:47831/api/node/task-center');
  assert.equal(posix.includes('--fail'), false);
  assert.ok(windows.includes('powershell.exe'));
  assert.match(psSource(windows), /Invoke-WebRequest .*TimeoutSec 15.*127\.0\.0\.1:47831\/api\/node\/task-center/);
  assert.ok(relayed.includes('/usr/bin/curl')); assert.equal(relayed.at(-1), 'http://127.0.0.1:48000/api/node/task-center');
});

test('signed task mutations keep UTF-8 task content in stdin, never shell arguments, on Windows and POSIX', async t => {
  const { file, key } = await keyFile(t);
  for (const platform of ['windows', 'posix']) {
    const { spawn, calls } = fakeSpawn([]), adapter = new SshPeerTaskCenter({ peer: peer(platform), actionKeyPath: file, spawn });
    assert.equal((await adapter.apply(action())).applied, true);
    const call = calls[0], headers = headersFrom(call);
    assert.equal(call.command, 'ssh'); assert.deepEqual(call.options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(JSON.parse(call.body).text, action().text);
    assert.ok(call.args.every(value => !value.includes('should-not-run')));
    const signature = signPeerAction(key, { method: 'POST', path: TASK_CENTER_ACTION_PATH, timestamp: headers[ACTION_HEADERS.timestamp], nonce: headers[ACTION_HEADERS.nonce], body: call.body });
    assert.equal(headers[ACTION_HEADERS.signature], signature);
    if (platform === 'windows') {
      const source = psSource(call.args);
      assert.match(source, /\$body=\[Console\]::In\.ReadToEnd\(\)/);
      assert.match(source, /\$bodyBytes=\$utf8\.GetBytes\(\$body\)/);
      assert.match(source, /TimeoutSec 60/); assert.doesNotMatch(source, /should-not-run/);
    } else {
      assert.equal(call.args[call.args.indexOf('--data-binary') + 1], '@-');
      assert.equal(call.args[call.args.indexOf('--max-time') + 1], '60');
      assert.equal(call.args.at(-1), 'http://127.0.0.1:47831' + TASK_CENTER_ACTION_PATH);
    }
  }
});

test('transport retry reuses the same signed body and nonce, then prefers its successful route', async t => {
  const { file } = await keyFile(t), { spawn, calls } = fakeSpawn(['not json', { status: 'ok', applied: true, requestId: 'request-one' }]);
  const adapter = new SshPeerTaskCenter({ peer: peer('windows', [direct, relay]), actionKeyPath: file, spawn });
  await adapter.apply(action());
  assert.equal(calls.length, 2); assert.deepEqual(headersFrom(calls[0]), headersFrom(calls[1]));
  assert.equal(calls[0].body.toString(), calls[1].body.toString());
  assert.equal(adapter.routes()[0], relay);
  assert.equal(calls[1].args.at(-1), 'http://127.0.0.1:48000' + TASK_CENTER_ACTION_PATH);
});

test('snapshot fallback enforces returned owner identity and retains a successful route', async () => {
  const calls = [], payload = { version: 1, device: { id: 'win' }, items: [] };
  const adapter = new SshPeerTaskCenter({ peer: peer('posix', [direct, relay]), execFile: async (...args) => {
    calls.push(args); return { stdout: JSON.stringify(calls.length === 1 ? { ...payload, device: { id: 'wrong' } } : payload) };
  } });
  assert.deepEqual(await adapter.read(), payload); assert.equal(calls.length, 2); assert.equal(adapter.routes()[0], relay);
  assert.equal(calls[0][2].maxBuffer, 16 * 1024 * 1024); assert.equal(calls[0][2].timeout, 20000);
  const unsupported = new SshPeerTaskCenter({ peer: peer(), execFile: async () => ({ stdout: JSON.stringify({ version: 0 }) }) });
  await assert.rejects(unsupported.read(), error => error.code === 'UNSUPPORTED_NODE');
  const offline = new SshPeerTaskCenter({ peer: peer(), execFile: async () => { throw Error('transport failed'); } });
  await assert.rejects(offline.read(), error => error.code === 'OFFLINE');
});

test('owner rejection stops retries while malformed responses fail without surfacing SSH diagnostics', async t => {
  const { file } = await keyFile(t), rejected = fakeSpawn([{ status: 'error', code: 'TASK_CONFLICT', message: '版本冲突，请刷新' }]);
  const adapter = new SshPeerTaskCenter({ peer: peer('posix', [direct, relay]), actionKeyPath: file, spawn: rejected.spawn });
  await assert.rejects(adapter.apply(action()), error => error.code === 'TASK_CONFLICT' && /版本冲突/.test(error.message));
  assert.equal(rejected.calls.length, 1);
  const bad = fakeSpawn(['not-json']);
  await assert.rejects(new SshPeerTaskCenter({ peer: peer(), actionKeyPath: file, spawn: bad.spawn }).apply(action()), error => error.code === 'UNCONFIRMED' && !/private/.test(error.message));
});

test('valid JSON null envelopes are handled as unsupported snapshots or unconfirmed actions', async t => {
  const { file } = await keyFile(t);
  const read = new SshPeerTaskCenter({ peer: peer(), execFile: async () => ({ stdout: 'null' }) });
  await assert.rejects(read.read(), error => error.code === 'UNSUPPORTED_NODE');
  const { spawn } = fakeSpawn(['null']);
  await assert.rejects(new SshPeerTaskCenter({ peer: peer(), actionKeyPath: file, spawn }).apply(action()), error => error.code === 'UNCONFIRMED');
});

test('image responses have a bounded larger budget and sign the dedicated read endpoint', async t => {
  const { file, key } = await keyFile(t), largeBody = JSON.stringify({ status: 'ok', version: 1, images: [], padding: 'x'.repeat(17 * 1024 * 1024) });
  const allowed = fakeSpawn([largeBody]), adapter = new SshPeerTaskCenter({ peer: peer(), actionKeyPath: file, spawn: allowed.spawn });
  const input = { scopeId: GENERAL_TASK_SCOPE_ID, id: 'task-one', expectedRevision: 'a'.repeat(64) };
  assert.equal((await adapter.images(input)).version, 1);
  const call = allowed.calls[0], headers = headersFrom(call);
  assert.equal(call.args.at(-1), 'http://127.0.0.1:47831' + TASK_IMAGES_ACTION_PATH);
  assert.equal(headers[ACTION_HEADERS.signature], signPeerAction(key, { method: 'POST', path: TASK_IMAGES_ACTION_PATH, timestamp: headers[ACTION_HEADERS.timestamp], nonce: headers[ACTION_HEADERS.nonce], body: call.body }));
  const tooLargeForAction = fakeSpawn([largeBody]);
  await assert.rejects(new SshPeerTaskCenter({ peer: peer(), actionKeyPath: file, spawn: tooLargeForAction.spawn }).apply(action()), error => error.code === 'UNCONFIRMED');
  assert.equal(tooLargeForAction.calls[0].killed, true);
  const tooLarge = fakeSpawn([Buffer.alloc(34 * 1024 * 1024 + 1)]);
  await assert.rejects(new SshPeerTaskCenter({ peer: peer(), actionKeyPath: file, spawn: tooLarge.spawn }).images(input), error => error.code === 'UNCONFIRMED');
  assert.equal(tooLarge.calls[0].killed, true);
  assert.throws(() => sshActionArguments(direct, headers, '/arbitrary/path'), /path is invalid/);
});
