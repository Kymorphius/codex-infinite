import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { normalizePeerDefinition } from '../src/peer-contract.mjs';
import { SshPeerAdapter } from '../src/ssh-peer-adapter.mjs';

function fixture({ routes = 2, read, ...options } = {}) {
  let now = 1000;
  const attempts = [], warnings = [];
  const peer = normalizePeerDefinition({ id: 'test-peer', name: 'Test peer', transports:
    Array.from({ length: routes }, (_, index) => ({ type: 'direct-ssh', host: `route${index}.test`, user: 'tester' })) });
  const adapter = new SshPeerAdapter({ peer, clock: () => now, logger: { warn: message => warnings.push(message) },
    async execFileImpl(_command, args) {
      const index = peer.transports.findIndex(transport => args.includes(`${transport.user}@${transport.host}`));
      attempts.push(index);
      const activity = args.at(-1).includes('/activity/');
      const value = await read?.(index, activity);
      return { stdout: JSON.stringify(value || (activity ? { schemaVersion: 1, entries: [] } : { schemaVersion: 1, tasks: [] })) };
    }, ...options });
  return { adapter, attempts, warnings, at: value => { now = value; } };
}

test('healthy fallback skips a failed preferred route during three fixed-clock snapshots', async () => {
  const f = fixture({ read: index => { if (index === 0) throw Error('offline'); } });
  for (let count = 0; count < 3; count++) assert.equal((await f.adapter.listTasks()).status, 'empty');
  assert.deepEqual(f.attempts, [0, 1, 1, 1]);
  assert.equal(f.warnings.length, 1);
  assert.match(f.warnings[0], /direct-ssh route 1 unavailable/);
  assert.equal(f.adapter.readFailures, 0);
  assert.equal(f.adapter.nextReadAt, 0);
});

test('preferred route resumes priority at its deadline and a later outage warns again', async () => {
  let preferredReady = false;
  const f = fixture({ read: index => { if (index === 0 && !preferredReady) throw Error('offline'); } });
  await f.adapter.listTasks();
  preferredReady = true;
  f.at(5999); await f.adapter.listTasks();
  assert.deepEqual(f.attempts, [0, 1, 1]);
  f.at(6000); await f.adapter.listTasks();
  assert.deepEqual(f.attempts, [0, 1, 1, 0]);
  assert.equal(f.warnings.length, 1);
  preferredReady = false;
  await f.adapter.listTasks(); await f.adapter.listTasks();
  assert.deepEqual(f.attempts.slice(-3), [0, 1, 1]);
  assert.equal(f.warnings.length, 2);
});

test('consecutive route failures use capped exponential cooldown without repeated warnings', async () => {
  const f = fixture({ backoffBaseMs: 5000, backoffMaxMs: 12000, read: index => { if (!index) throw Error('offline'); } });
  await f.adapter.listTasks();
  let now = 1000;
  for (const delay of [5000, 10000, 12000, 12000]) {
    const preferredAttempts = f.attempts.filter(index => index === 0).length;
    now += delay;
    f.at(now - 1); await f.adapter.listTasks();
    assert.equal(f.attempts.filter(index => index === 0).length, preferredAttempts);
    f.at(now); await f.adapter.listTasks();
    assert.equal(f.attempts.filter(index => index === 0).length, preferredAttempts + 1);
  }
  assert.equal(f.warnings.length, 1);
});

test('fallback failure preserves unavailable results and existing peer-wide backoff', async () => {
  let fallbackReady = true;
  const f = fixture({ read: index => { if (!index || !fallbackReady) throw Error('offline'); } });
  await f.adapter.listTasks();
  fallbackReady = false;
  assert.equal((await f.adapter.listTasks()).status, 'error');
  assert.equal((await f.adapter.listTasks()).status, 'error');
  await assert.rejects(f.adapter.getActivity('thread-1'), { statusCode: 503 });
  assert.deepEqual(f.attempts, [0, 1, 1]);
  assert.equal(f.adapter.nextReadAt, 6000);
  f.at(6000);
  assert.equal((await f.adapter.listTasks()).status, 'error');
  assert.deepEqual(f.attempts, [0, 1, 1, 0, 1]);
  assert.equal(f.adapter.readFailures, 2);
  assert.equal(f.adapter.nextReadAt, 16000);
  assert.equal(f.warnings.length, 2);
  f.at(15999); await f.adapter.listTasks();
  assert.equal(f.attempts.length, 5);
});

test('snapshot and activity reads share cooldown while activity recovery clears it', async () => {
  let preferredReady = false;
  const f = fixture({ read: index => { if (!index && !preferredReady) throw Error('offline'); } });
  await f.adapter.listTasks();
  assert.equal((await f.adapter.getActivity('thread-1')).transport, 'direct-ssh');
  assert.deepEqual(f.attempts, [0, 1, 1]);
  preferredReady = true; f.at(6000);
  await f.adapter.getActivity('thread-1'); await f.adapter.listTasks();
  assert.deepEqual(f.attempts, [0, 1, 1, 0, 0]);
  assert.equal(f.warnings.length, 1);
});

test('equal-labelled routes have independent cooldown and warning state', async () => {
  const f = fixture({ routes: 3, read: index => { if (index < 2) throw Error('offline'); } });
  await f.adapter.listTasks(); await f.adapter.listTasks();
  assert.deepEqual(f.attempts, [0, 1, 2, 2]);
  assert.equal(f.warnings.length, 2);
  assert.match(f.warnings[0], /direct-ssh route 1 unavailable/);
  assert.match(f.warnings[1], /direct-ssh route 2 unavailable/);
  assert.equal(f.warnings.some(message => message.includes('.test')), false);
});

test('overlapping snapshots retain one request while fallback is pending', async () => {
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const f = fixture({ read: async index => { if (!index) throw Error('offline'); await blocker; } });
  const first = f.adapter.listTasks(), second = f.adapter.listTasks();
  release();
  assert.deepEqual(await first, await second);
  assert.deepEqual(f.attempts, [0, 1]);
});

test('signed mutation still attempts a preferred route that is cooling for reads', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-read-cooldown-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const actionKeyPath = path.join(directory, 'key');
  await fs.writeFile(actionKeyPath, Buffer.alloc(32, 7).toString('base64'), { mode: 0o600 });
  const mutations = [];
  const f = fixture({ actionKeyPath, read: index => { if (!index) throw Error('offline'); },
    spawnImpl(_command, args) {
      mutations.push(args);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      child.stdin.on('finish', () => {
        child.stdout.end(JSON.stringify({ status: 'ok', accepted: true }));
        queueMicrotask(() => child.emit('close', 0));
      });
      return child;
    } });
  await f.adapter.listTasks();
  assert.equal((await f.adapter.sendMessage('thread-1', 'test')).accepted, true);
  assert.equal(mutations.length, 1);
  assert.ok(mutations[0].includes('tester@route0.test'));
  assert.ok(mutations[0].includes('StrictHostKeyChecking=yes'));
  assert.ok(mutations[0].includes('--data-binary'));
});
