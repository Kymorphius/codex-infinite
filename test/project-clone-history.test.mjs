import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cloneVerifiedHistory, readCloneMetadata } from '../src/project-clone-history.mjs';
import { cloneNativeProject, preservedCloneCwd } from '../src/native-project-clone.mjs';
import { registerNativeSidebarProjectState } from '../src/native-project-sidebar-registry.mjs';
const sha = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'project-clone-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sourceThreadId = randomUUID(), parent = randomUUID(), localThreadId = randomUUID(), localParent = randomUUID();
  const body = Buffer.from('历史正文与旧 ID ' + sourceThreadId + '\n' + 'x'.repeat(200000));
  const source = Buffer.concat([Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: sourceThreadId, cwd: '/old', timestamp: '2026-09-01T12:00:00Z', source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } }) + '\n'), body]);
  const sourcePath = path.join(directory, 'original.jsonl'), destinationPath = path.join(directory, 'output.jsonl');
  await fs.writeFile(sourcePath, source);
  return { directory, body, sourcePath, destinationPath, sourceThreadId, localThreadId, cwd: '/new', idMap: { [parent]: localParent }, localParent, sha256: sha(source), bodySha256: sha(body) };
}
test('clone preserves all history bytes and remaps parent identity; retry verifies output', async t => {
  const args = await fixture(t);
  await cloneVerifiedHistory(args);
  const { record, offset } = await readCloneMetadata(args.destinationPath);
  assert.equal(record.payload.source.subagent.thread_spawn.parent_thread_id, args.localParent);
  assert.deepEqual((await fs.readFile(args.destinationPath)).subarray(offset), args.body);
  assert.equal((await cloneVerifiedHistory(args)).resumed, true);
  await fs.appendFile(args.destinationPath, 'tampered');
  await assert.rejects(cloneVerifiedHistory(args), /checksum/);
});
test('source checksum failure never publishes a clone', async t => {
  const args = await fixture(t);
  await assert.rejects(cloneVerifiedHistory({ ...args, sha256: '0'.repeat(64) }), /checksum/);
  await assert.rejects(fs.stat(args.destinationPath), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(args.directory), ['original.jsonl']);
});
test('multi-root registration does not reuse a partially overlapping project', () => {
  const state = { 'local-projects': { old: { id: 'old', rootPaths: ['/a'] } } };
  const result = registerNativeSidebarProjectState(state, { codexHome: '/home', serverProjectId: 'server', projectName: 'Clone', rootPaths: ['/a', '/b'], threadIds: ['thread'], legacyProjectId: 'new' });
  assert.equal(result.projectId, 'new');
  assert.deepEqual(result.state['local-projects'].new.rootPaths, ['/a', '/b'].map(item => path.resolve(item)));
  assert.deepEqual(state['local-projects'], { old: { id: 'old', rootPaths: ['/a'] } });
  assert.equal(registerNativeSidebarProjectState(result.state, { codexHome: '/home', serverProjectId: 'server', projectName: 'Clone', rootPaths: ['/b', '/a'], threadIds: [] }).projectId, 'new');
});
test('native import sends only explicit members and resumes with the same IDs', async t => {
  const args = await fixture(t), requests = [];
  const receiptPath = path.join(args.directory, 'receipt.json');
  const manifest = { projectId: 'source', projectName: 'Clone', sessions: [{ ...args, relativePath: 'original.jsonl', timestamp: '2026-09-01T12:00:00Z', isProjectThread: true, title: '保留标题' }] };
  const childId = randomUUID();
  const childMetadata = (await readCloneMetadata(args.sourcePath)).record;
  childMetadata.payload.id = childId; childMetadata.payload.source.subagent.thread_spawn.parent_thread_id = args.sourceThreadId;
  const childSource = Buffer.concat([Buffer.from(JSON.stringify(childMetadata) + '\n'), args.body]);
  await fs.writeFile(path.join(args.directory, 'child.jsonl'), childSource);
  manifest.sessions.push({ ...manifest.sessions[0], sourceThreadId: childId, relativePath: 'child.jsonl', isProjectThread: false, sha256: sha(childSource) });
  const aliasHome = path.join(args.directory, 'alias');
  await fs.symlink(path.join(args.directory, 'home'), aliasHome);
  const client = { initialize: async () => {}, request: async (method, params) => {
    requests.push({ method, params });
    if (method === 'thread/read') {
      const receipt = JSON.parse(await fs.readFile(receiptPath));
      return { thread: { path: receipt.sessions.find(item => item.localThreadId === params.threadId).path.replace(path.join(args.directory, 'home'), aliasHome) } };
    }
    if (method === 'thread/turns/list') return { data: [{ id: 'turn' }] };
    if (method === 'thread/resume') return { cwd: params.cwd };
    return method === 'project/import' ? { project: { id: 'native' } } : {};
  } };
  const roots = [path.join(args.directory, 'root'), path.join(args.directory, 'second')];
  for (const root of roots) await fs.mkdir(root);
  const options = { manifest, stagedHome: args.directory, codexHome: path.join(args.directory, 'home'), roots, fallbackCwd: roots[0], receiptPath, client, registry: { register: async () => ({ projectId: 'sidebar' }) } };
  const first = await cloneNativeProject(options), second = await cloneNativeProject(options);
  assert.equal(first.sessions[0].localThreadId, second.sessions[0].localThreadId);
  assert.equal(requests.find(request => request.method === 'project/import').params.threads.length, 1);
  const childRecord = (await readCloneMetadata(first.sessions[1].path)).record;
  assert.equal(childRecord.payload.source.subagent.thread_spawn.parent_thread_id, first.sessions[0].localThreadId);
  assert.equal(requests.filter(request => request.method === 'project/import').length, 1);
  assert.deepEqual(requests.find(request => request.method === 'project/import').params.roots, roots.map(root => ({ path: root })));
  await assert.rejects(cloneNativeProject({ ...options, roots: [roots[0]] }), /different operation/);
});

test('resume preserves the original body hash while accepting only native cwd settings', async t => {
  const args = await fixture(t);
  await cloneVerifiedHistory(args);
  const event = { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_id: args.localThreadId, thread_settings: { cwd: args.cwd } } };
  await fs.appendFile(args.destinationPath, JSON.stringify(event) + '\n');
  const resumed = await cloneVerifiedHistory({ ...args, originalBodyBytes: args.body.length });
  assert.equal(resumed.nativeSettingsRecords, 1);
  assert.equal(resumed.bodyBytes, args.body.length);
  await fs.appendFile(args.destinationPath, JSON.stringify({ type: 'response_item', payload: { text: 'unexpected' } }) + '\n');
  await assert.rejects(cloneVerifiedHistory({ ...args, originalBodyBytes: args.body.length }), /Unexpected clone history suffix/);
});

test('a new paginated clone recovers when its native hash was not saved yet', async t => {
  const args = await fixture(t);
  const header = (await readCloneMetadata(args.sourcePath)).record;
  const body = Buffer.from(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', thread_id: args.sourceThreadId } }) + '\n');
  const source = Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), body]);
  await fs.writeFile(args.sourcePath, source);
  const options = { ...args, idMap: { [args.sourceThreadId]: args.localThreadId }, sha256: sha(source), bodySha256: sha(body) };
  const first = await cloneVerifiedHistory(options), recovered = await cloneVerifiedHistory(options);
  assert.equal(recovered.resumed, true);
  assert.equal(recovered.nativeBodySha256, first.nativeBodySha256);
});
test('clone keeps a local cwd inside a selected root and falls back for foreign paths', () => {
  // Regression: a `${root}/` prefix never matched Windows paths, so D:\proj\sub fell back to the root.
  const win = (cwd, roots = ['D:\\proj']) => preservedCloneCwd(cwd, roots, roots[0], path.win32);
  assert.equal(win('D:\\proj\\sub'), 'D:\\proj\\sub');
  assert.equal(win('d:\\PROJ\\sub'), 'd:\\PROJ\\sub');
  assert.equal(win('D:\\proj'), 'D:\\proj');
  assert.equal(win('D:\\'), 'D:\\');
  assert.equal(win('D:\\project2'), 'D:\\proj');
  assert.equal(win('D:\\proj\\..cache'), 'D:\\proj\\..cache');
  assert.equal(win('/Users/x', ['C:\\Users']), 'C:\\Users');
  assert.equal(win('relative\\sub'), 'D:\\proj');
  const posix = (cwd, roots = ['/work/proj']) => preservedCloneCwd(cwd, roots, roots[0], path.posix);
  assert.equal(posix('/work/proj/sub'), '/work/proj/sub');
  assert.equal(posix('/work'), '/work');
  assert.equal(posix('/work/project2'), '/work/proj');
  assert.equal(posix('/work/proj/../other'), '/work/proj');
  assert.equal(posix('D:\\proj\\sub'), '/work/proj');
});
