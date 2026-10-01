import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ButlerWorkspace } from '../src/butler-workspace.mjs';
import { createButlerWorkspace, butlerCwdFor } from '../src/butler-runtime.mjs';

const id = '00000000-0000-4000-8000-000000000001';
const inputs = (title = '任务') => ({ tasks: [{ id, title, status: 'completed', updatedAt: '2026-09-29T10:00:00Z', device: { id: 'mac' } }],
  devices: [{ id: 'mac', name: 'Mac' }], localDeviceId: 'mac', attention: { stale: false, items: [], statuses: {} } });

async function workspace(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'butler-'));
  const cwd = path.join(root, 'home', 'butler');
  let clock = Date.parse('2026-09-29T12:00:00Z'), data = inputs();
  const logs = [];
  const service = new ButlerWorkspace({ cwd, sessionRoots: ['/s'], read: async () => data, now: () => new Date(clock), log: message => logs.push(message), ...options });
  return { root, cwd, service, logs, set: value => { data = value; }, tick: ms => { clock += ms; } };
}

test('refresh creates a private workspace with AGENTS.md and overview files', async () => {
  const { cwd, service } = await workspace();
  const overview = await service.refresh();
  assert.equal(overview.rows[0].open, `#ccc-open/local/${id}`);
  assert.equal((await fs.stat(cwd)).mode & 0o777, 0o700);
  assert.match(await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), /^<!-- butler-agents v1 -->/);
  const json = JSON.parse(await fs.readFile(path.join(cwd, 'overview.json'), 'utf8'));
  assert.equal(json.rows[0].id, id);
  assert.equal((await fs.stat(path.join(cwd, 'overview.json'))).mode & 0o777, 0o600);
  assert.match(await fs.readFile(path.join(cwd, 'overview.md'), 'utf8'), /\| 任务 \|/);
  assert.deepEqual((await fs.readdir(cwd)).sort(), ['AGENTS.md', 'overview.json', 'overview.md']);
});

test('unchanged content is not rewritten until the heartbeat; changes and stale AGENTS.md are', async () => {
  const { cwd, service, set, tick } = await workspace();
  await service.refresh();
  const first = await fs.readFile(path.join(cwd, 'overview.json'), 'utf8');
  tick(30000); await service.refresh();
  assert.equal(await fs.readFile(path.join(cwd, 'overview.json'), 'utf8'), first);
  set(inputs('新标题')); await service.refresh();
  assert.match(await fs.readFile(path.join(cwd, 'overview.md'), 'utf8'), /新标题/);
  const changed = await fs.readFile(path.join(cwd, 'overview.json'), 'utf8');
  tick(600000); await service.refresh();
  assert.notEqual(await fs.readFile(path.join(cwd, 'overview.json'), 'utf8'), changed);
  await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'old');
  await service.refresh();
  assert.match(await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8'), /butler-agents v1/);
});

test('writes are atomic through a temp file and failures are logged once without throwing', async () => {
  const calls = [];
  const fake = { mkdir: async () => {}, readFile: async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }); },
    writeFile: async (file, _content, options) => { calls.push(['write', path.basename(file), options.mode]); },
    rename: async (from, to) => { calls.push(['rename', path.basename(from).endsWith('.tmp'), path.basename(to)]); }, rm: async () => {} };
  const { service } = await workspace({ fs: fake });
  await service.refresh();
  assert.deepEqual(calls.filter(call => call[0] === 'rename').map(call => call.slice(1)), [[true, 'AGENTS.md'], [true, 'overview.json'], [true, 'overview.md']]);
  assert.ok(calls.filter(call => call[0] === 'write').every(call => call[2] === 0o600));
  const failing = await workspace({ read: async () => { throw Error('offline'); } });
  assert.equal(await failing.service.refresh(), null);
  await failing.service.refresh();
  assert.equal(failing.logs.filter(message => message.includes('offline')).length, 1);
});

test('concurrent refreshes share one run and start/stop manage an unref timer', async () => {
  let reads = 0;
  const { service } = await workspace({ read: async () => { reads += 1; return inputs(); } });
  await Promise.all([service.refresh(), service.refresh()]);
  assert.equal(reads, 1);
  service.start(); service.start();
  assert.equal(service.timer.hasRef(), false);
  service.stop();
  assert.equal(service.timer, null);
});

test('runtime factory reads existing services and places the butler under the wrapper home', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'butler-rt-'));
  const config = { wrapperCodexHome: root, sessionRoot: '/s', archivedSessionRoot: '/a', nodeDevice: { id: 'mac' } };
  const service = createButlerWorkspace({ config, adapter: { listTasks: async () => ({ tasks: inputs().tasks, devices: [{ id: 'mac', name: 'Mac' }] }) },
    terminalConversations: { list: async () => { throw Error('busy'); } }, attention: { read: async () => ({ stale: false, items: [], statuses: {} }) } });
  assert.equal(service.cwd, butlerCwdFor(config));
  assert.equal(service.cwd, path.join(root, 'butler'));
  assert.deepEqual(service.sessionRoots, ['/s', '/a']);
  const overview = await service.refresh();
  assert.deepEqual([overview.rows.length, overview.stale, overview.devices[0].local], [1, false, true]);
});
