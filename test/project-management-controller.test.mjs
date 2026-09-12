import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectController } from '../public/features/projects/index.js';

const revision = 'a'.repeat(64), newerRevision = 'b'.repeat(64);
function payload({ remote = false, rev = revision, status = 'connected' } = {}) {
  return { schemaVersion: 1, devices: [{ device: { id: 'owner', name: '工作机', kind: remote ? 'remote-codex' : 'local-codex' }, status,
    snapshot: { schemaVersion: 1, revision: rev, capabilities: ['open', 'item-move'],
      projects: [{ key: 'project', name: 'Example', source: 'codex', sourceDirectories: ['/work/example'], conversationKeys: [], childrenLoaded: true }],
      sections: [{ id: 'projects', kind: 'projects', name: '项目', itemKeys: ['project'] }, { id: 'pinned', kind: 'pinned', name: '置顶', itemKeys: [] }] } }] };
}
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const identity = controller => controller.getState().catalog.projects[0].identity;
const confirmed = data => ({ applied: true, deviceId: 'owner', snapshot: data.devices[0].snapshot });

test('read failure preserves cards and filters, marks them stale, and a later success recovers', async () => {
  let count = 0;
  const controller = createProjectController({ fetchImpl: async () => { if (++count === 2) throw Error('连接失败'); return response(payload()); } });
  await controller.refresh(); controller.setFilters({ query: 'example' });
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.getState().visible.length, 1);
  assert.equal(controller.getState().filters.query, 'example');
  assert.equal(controller.getState().catalog.projects[0].stale, true);
  assert.match(controller.getState().readError, /连接失败/);
  await controller.refresh();
  assert.equal(controller.getState().stale, false);
  assert.equal(controller.getState().readError, '');
});

test('out of order reads cannot replace the newest catalog', async () => {
  const first = deferred(), second = deferred(); let count = 0;
  const controller = createProjectController({ fetchImpl: () => ++count === 1 ? first.promise : second.promise });
  const oldRead = controller.refresh(), newRead = controller.refresh();
  second.resolve(response(payload({ rev: newerRevision }))); await newRead;
  first.resolve(response(payload())); await oldRead;
  assert.equal(controller.getState().catalog.projects[0].revision, newerRevision);
  assert.equal(controller.getState().loading, false);
});

test('old in-flight read cannot overwrite a confirmed owner action; action payload includes owner and revision', async () => {
  const oldRead = deferred(); let reads = 0, sent;
  const controller = createProjectController({ fetchImpl: (path, options) => {
    if (path.endsWith('/actions')) { sent = JSON.parse(options.body); return response(confirmed(payload({ rev: newerRevision }))); }
    return ++reads === 1 ? response(payload()) : oldRead.promise;
  } });
  await controller.refresh();
  const pending = controller.refresh();
  assert.equal(await controller.act(identity(controller), 'pin'), true);
  oldRead.resolve(response(payload())); await pending;
  assert.deepEqual(sent, { action: 'item-move', deviceId: 'owner', itemKey: 'project', sectionId: 'projects', expectedRevision: revision, targetSectionId: 'pinned' });
  assert.equal(controller.getState().catalog.projects[0].revision, newerRevision);
});

test('conflict refreshes state and never replays the write', async () => {
  let writes = 0, reads = 0; const messages = [];
  const controller = createProjectController({ notice: message => messages.push(message), fetchImpl: path => {
    if (path.endsWith('/actions')) { writes++; return response({ message: '版本已变化' }, 409); }
    return response(payload({ rev: ++reads === 1 ? revision : newerRevision }));
  } });
  await controller.refresh();
  assert.equal(await controller.act(identity(controller), 'pin'), false);
  assert.equal(writes, 1); assert.equal(reads, 2);
  assert.equal(controller.getState().catalog.projects[0].revision, newerRevision);
  assert.match(messages.at(-1), /请核对后重试/);
});

test('confirmed local open closes embedded parent while remote open only reports the owning device', async () => {
  for (const remote of [false, true]) {
    let closed = 0; const messages = [], data = payload({ remote });
    const controller = createProjectController({ onLocalOpen: () => closed++, notice: message => messages.push(message),
      fetchImpl: path => response(path.endsWith('/actions') ? confirmed(data) : data) });
    await controller.refresh();
    assert.equal(await controller.act(identity(controller), 'open'), true);
    assert.equal(closed, remote ? 0 : 1);
    assert.match(messages.at(-1), remote ? /已在 工作机 打开/ : /已打开/);
  }
});

test('missing owner confirmation does not report success or close the parent', async () => {
  let closed = 0, writes = 0; const messages = [];
  const controller = createProjectController({ onLocalOpen: () => closed++, notice: message => messages.push(message), fetchImpl: path => {
    if (path.endsWith('/actions')) { writes++; return response({ status: 'ok' }); }
    return response(payload());
  } });
  await controller.refresh();
  assert.equal(await controller.act(identity(controller), 'open'), false);
  assert.equal(closed, 0); assert.equal(writes, 1);
  assert.match(messages.at(-1), /未确认/);
});

test('offline cards block native writes but paths can still be copied', async () => {
  const paths = [], calls = [];
  const controller = createProjectController({ copyText: async text => paths.push(text), fetchImpl: path => { calls.push(path); return response(payload({ status: 'offline' })); } });
  await controller.refresh();
  assert.equal(await controller.act(identity(controller), 'open'), false);
  assert.equal(await controller.act(identity(controller), 'copy'), true);
  assert.deepEqual(calls, ['/api/sidebar']); assert.deepEqual(paths, ['/work/example']);
});

test('timeout releases read state and aborts transport', async () => {
  let signal;
  const controller = createProjectController({ requestTimeoutMs: 5, fetchImpl: (_, options) => { signal = options.signal; return new Promise(() => {}); } });
  assert.equal(await controller.refresh(), false);
  assert.equal(controller.getState().loading, false);
  assert.equal(signal.aborted, true);
  assert.match(controller.getState().readError, /请求超时/);
});

test('write timeout performs one readback and never repeats the write', async () => {
  let writes = 0, reads = 0, closed = 0;
  const controller = createProjectController({ requestTimeoutMs: 5, onLocalOpen: () => closed++, fetchImpl: path => {
    if (path.endsWith('/actions')) { writes++; return new Promise(() => {}); }
    reads++; return response(payload());
  } });
  await controller.refresh();
  assert.equal(await controller.act(identity(controller), 'open'), false);
  assert.equal(writes, 1); assert.equal(reads, 2); assert.equal(closed, 0);
  assert.equal(controller.getState().busy, null);
});

test('malformed read retains prior catalog and suppresses fabricated empty success', async () => {
  let reads = 0;
  const controller = createProjectController({ fetchImpl: () => response(++reads === 1 ? payload() : { schemaVersion: 1, devices: [{}] }) });
  await controller.refresh(); await controller.refresh();
  assert.equal(controller.getState().catalog.projects.length, 1);
  assert.equal(controller.getState().stale, true);
  assert.match(controller.getState().readError, /格式无效/);
});

test('successful refresh clears device and section filters removed from the catalog while preserving search and sort', async () => {
  let reads = 0;
  const next = payload(); next.devices[0].device.id = 'replacement';
  const controller = createProjectController({ fetchImpl: () => response(++reads === 1 ? payload() : next) });
  await controller.refresh();
  controller.setFilters({ query: 'Example', device: 'owner', section: JSON.stringify(['owner', 'projects']), sort: 'name' });
  await controller.refresh();
  assert.deepEqual(controller.getState().filters, { query: 'Example', device: '', section: '', source: '', sort: 'name' });
  assert.equal(controller.getState().visible.length, 1);
});

test('confirmed owner snapshot clears a removed section filter', async () => {
  const next = payload({ rev: newerRevision });
  next.devices[0].snapshot.sections = [{ id: 'pinned', name: '置顶', kind: 'pinned', itemKeys: ['project'] }];
  const controller = createProjectController({ fetchImpl: path => response(path.endsWith('/actions') ? confirmed(next) : payload()) });
  await controller.refresh(); controller.setFilters({ section: JSON.stringify(['owner', 'projects']) });
  assert.equal(await controller.act(identity(controller), 'pin'), true);
  assert.equal(controller.getState().filters.section, '');
  assert.equal(controller.getState().visible.length, 1);
});
