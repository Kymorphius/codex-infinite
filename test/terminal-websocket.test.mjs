import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachTerminalWebSocket } from '../src/terminal-websocket.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TERMINAL_LIMITS } from '../src/terminal-contract.mjs';

async function fixture(t, available = true) {
  const processes = [], clients = [];
  const service = new TerminalService({ defaultCwd: '/terminal-fixture', validateCwd: async () => {},
    spawnProcess: async () => {
      const dataListeners = new Set(), exitListeners = new Set();
      const process = { writes: [], sizes: [], kills: 0,
        onData(fn) { dataListeners.add(fn); return { dispose: () => dataListeners.delete(fn) }; },
        onExit(fn) { exitListeners.add(fn); return { dispose: () => exitListeners.delete(fn) }; },
        output(data) { for (const fn of dataListeners) fn(data); },
        exit(exitCode) { for (const fn of exitListeners) fn({ exitCode }); },
        write(data) { this.writes.push(data); this.output(`echo:${data}`); },
        resize(cols, rows) { this.sizes.push([cols, rows]); this.output(`resize:${cols}x${rows}`); },
        async kill() { this.kills++; },
        listenerCount() { return dataListeners.size + exitListeners.size; },
      };
      processes.push(process); return process;
    } });
  const server = http.createServer((request, response) => response.end());
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  const stop = attachTerminalWebSocket({ server, service: available ? service : null, dashboardOrigin: origin });
  t.after(async () => {
    for (const ws of clients) ws.terminate();
    stop(); await service.dispose(); await new Promise(resolve => server.close(resolve));
  });
  const raw = (id, headers = {}, pathname = '/api/terminal/socket') => {
    const query = id === undefined ? '' : `?id=${encodeURIComponent(id)}`;
    const requestHeaders = { origin, ...headers };
    for (const key of Object.keys(requestHeaders)) if (requestHeaders[key] === undefined) delete requestHeaders[key];
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}${pathname}${query}`, { headers: requestHeaders });
    ws.on('error', () => {}); clients.push(ws); return ws;
  };
  const connect = async id => {
    const ws = raw(id), frames = [], waiters = [];
    ws.on('message', data => {
      const frame = JSON.parse(data.toString());
      const waiting = waiters.shift(); if (waiting) waiting(frame); else frames.push(frame);
    });
    const next = () => frames.length ? Promise.resolve(frames.shift()) : new Promise(resolve => waiters.push(resolve));
    await once(ws, 'open'); return { ws, next };
  };
  const rejected = async (id, headers, pathname) => {
    const ws = raw(id, headers, pathname);
    return new Promise((resolve, reject) => {
      ws.once('open', () => reject(Error('unexpected WebSocket connection')));
      ws.once('unexpected-response', (_request, response) => {
        response.resume(); const status = response.statusCode; ws.terminate(); resolve(status);
      });
    });
  };
  return { service, processes, connect, rejected, origin, server, stop };
}

test('terminal websocket requires exact Origin and Host and an existing valid session', { timeout: 10000 }, async t => {
  const { service, rejected, origin, processes } = await fixture(t);
  const session = await service.create({});
  for (const headers of [
    { origin: undefined }, { origin: '' }, { origin: 'null' }, { origin: 'https://attacker.example' },
    { origin: 'http://127.0.0.1:1' },
    { origin: `${origin}/` }, { origin: origin.replace('127.0.0.1', 'localhost') },
    { host: 'attacker.example' }, { host: '127.0.0.1:1' },
  ]) assert.equal(await rejected(session.id, headers), 403, JSON.stringify(headers));
  assert.equal(await rejected(undefined), 400);
  assert.equal(await rejected('../outside'), 400);
  assert.equal(await rejected('absent'), 404);
  assert.equal(await rejected(session.id, {}, '/api/terminal/unknown'), 404);
  assert.equal(processes.length, 1);
  assert.equal(service.get(session.id).writer, null);
});

test('terminal websocket reports unavailable service', { timeout: 10000 }, async t => {
  const { rejected } = await fixture(t, false);
  assert.equal(await rejected('absent'), 503);
});

test('terminal websocket reconnect replays output, keeps one controller and preserves its PTY', { timeout: 10000 }, async t => {
  const { service, processes, connect } = await fixture(t);
  const session = await service.create({}), process = processes[0];
  process.output('before connection\r\n');
  const first = await connect(session.id);
  const ready = await first.next();
  assert.equal(ready.type, 'ready'); assert.equal(ready.replay, 'before connection\r\n');
  assert.equal(ready.session.id, session.id);
  process.output('live output\r\n');
  assert.deepEqual(await first.next(), { type: 'data', data: 'live output\r\n' });
  const takeover = once(first.ws, 'close');
  const second = await connect(session.id);
  assert.equal((await takeover)[0], 4001);
  assert.equal((await second.next()).replay, 'before connection\r\nlive output\r\n');
  second.ws.send(JSON.stringify({ type: 'input', data: '你好\r' }));
  assert.deepEqual(await second.next(), { type: 'data', data: 'echo:你好\r' });
  second.ws.send(JSON.stringify({ type: 'resize', cols: 132, rows: 42 }));
  assert.deepEqual(await second.next(), { type: 'data', data: 'resize:132x42' });
  assert.deepEqual(process.writes, ['你好\r']); assert.deepEqual(process.sizes, [[132, 42]]);
  const detached = once(second.ws, 'close'); second.ws.close(); await detached;
  process.output('while disconnected\r\n');
  const third = await connect(session.id), replay = await third.next();
  assert.ok(replay.replay.endsWith('while disconnected\r\n'));
  assert.equal(replay.session.cols, 132); assert.equal(replay.session.rows, 42);
  assert.equal(processes.length, 1); assert.equal(process.kills, 0);
  const closed = once(third.ws, 'close'); await service.close(session.id);
  assert.equal((await closed)[0], 4000);
  assert.equal(process.kills, 1); assert.equal(process.listenerCount(), 0);
  assert.deepEqual(service.list().sessions, []);
});

test('terminal websocket rejects malformed, binary, unknown and oversized frames without killing PTY', { timeout: 10000 }, async t => {
  const { service, processes, connect } = await fixture(t);
  const session = await service.create({}), process = processes[0];
  const cases = [
    ['{', 1008], [Buffer.from('{}'), 1008], ['[]', 1008], ['null', 1008],
    [JSON.stringify({ type: 'execute', command: 'echo unsafe' }), 1008],
    [JSON.stringify({ type: 'input', data: 'ignored', command: 'unsafe' }), 1008],
    [JSON.stringify({ type: 'resize', cols: 0, rows: 24 }), 1008],
    [JSON.stringify({ type: 'input', data: 'x'.repeat(TERMINAL_LIMITS.inputBytes + 1) }), 1008],
    ['x'.repeat(TERMINAL_LIMITS.frameBytes + 1), 1009],
  ];
  for (const [payload, expectedCode] of cases) {
    const connection = await connect(session.id); await connection.next();
    const closed = once(connection.ws, 'close'); connection.ws.send(payload);
    assert.equal((await closed)[0], expectedCode);
  }
  assert.deepEqual(process.writes, []); assert.deepEqual(process.sizes, []);
  assert.equal(process.kills, 0); assert.equal(processes.length, 1);
  assert.equal(service.get(session.id).writer, null);
});

test('terminal websocket reports process exit on reconnect and service shutdown cleans active sockets', { timeout: 10000 }, async t => {
  const { service, processes, connect, rejected } = await fixture(t);
  const exited = await service.create({}), running = await service.create({});
  processes[0].output('complete\r\n'); processes[0].exit(7);
  const completed = await connect(exited.id), ready = await completed.next();
  assert.equal(ready.session.status, 'exited'); assert.equal(ready.replay, 'complete\r\n');
  assert.deepEqual(await completed.next(), { type: 'exit', exitCode: 7 });
  const active = await connect(running.id); await active.next();
  const closeCompleted = once(completed.ws, 'close'), closeActive = once(active.ws, 'close');
  await service.dispose();
  assert.equal((await closeCompleted)[0], 1001); assert.equal((await closeActive)[0], 1001);
  assert.equal(processes[0].kills, 0); assert.equal(processes[1].kills, 1);
  assert.ok(processes.every(process => process.listenerCount() === 0));
  assert.deepEqual(service.list().sessions, []);
  assert.equal(await rejected(running.id), 404);
});
