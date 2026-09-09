import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GptContextCatalog } from '../src/gpt-context-catalog.mjs';
import { GptContextService } from '../src/gpt-context-service.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const emptyId = '22222222-2222-4222-8222-222222222222';
const threadId = n => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gpt-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessions = path.join(root, 'sessions'), dbPath = path.join(root, 'state.sqlite');
  await fs.mkdir(sessions);
  const file = path.join(sessions, 'thread.jsonl');
  await fs.writeFile(file, '');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE projects(id TEXT, name TEXT, position INTEGER);
    CREATE TABLE project_roots(project_id TEXT, path TEXT, position INTEGER);
    CREATE TABLE threads(id TEXT, title TEXT, cwd TEXT, rollout_path TEXT, project_id TEXT,
      source TEXT, archived INTEGER, created_at INTEGER, updated_at INTEGER);`);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run(projectId, 'Current project', 0);
  db.prepare('INSERT INTO projects VALUES(?,?,?)').run(emptyId, 'Empty project', 1);
  db.prepare('INSERT INTO project_roots VALUES(?,?,?)').run(projectId, '/work/current', 0);
  for (const [n, cwd, project, source, archived] of [
    [1, '/work/old', projectId, 'vscode', 0], [2, '/work/current/sub', null, 'vscode', 0],
    [3, '/work/current', projectId, 'subagent', 0], [4, '/work/current', projectId, 'vscode', 1]
  ]) db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?,?)').run(threadId(n), `Old title ${n}`, cwd, file, project, source, archived, 100, 200 + n);
  db.close();
  const titleIndexPath = path.join(root, 'titles.jsonl');
  await fs.writeFile(titleIndexPath, JSON.stringify({ id: threadId(1), thread_name: 'Current title' }) + '\n');
  const catalog = new GptContextCatalog({ databasePath: dbPath, sessionRoots: [sessions], titleIndexPath,
    device: { id: 'test-local', name: 'Test machine' } });
  return { root, sessions, file, dbPath, catalog, service: new GptContextService({ catalog }) };
}

test('catalog reads native membership, current titles, inferred roots and empty projects without writes', async t => {
  const f = await fixture(t), before = await fs.readFile(f.dbPath);
  const snapshot = await f.catalog.snapshot();
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.conversations.find(x => x.id === threadId(1)).title, 'Current title');
  assert.equal(snapshot.conversations.find(x => x.id === threadId(1)).projectMembership, 'native');
  assert.equal(snapshot.conversations.find(x => x.id === threadId(2)).projectId, projectId);
  assert.equal(snapshot.conversations.find(x => x.id === threadId(2)).projectMembership, 'directory-inferred');
  const projects = await f.service.listProjects();
  assert.equal(projects.projects[0].conversationCount, 2);
  assert.equal(projects.projects[1].conversationCount, 0);
  assert.deepEqual(await fs.readFile(f.dbPath), before);
});

test('search is bounded and excludes internal/archived records by default', async t => {
  const { service } = await fixture(t);
  const first = await service.searchConversations({ projectId, limit: 1 });
  assert.equal(first.total, 2); assert.equal(first.nextOffset, 1);
  const second = await service.searchConversations({ projectId, limit: 1, offset: first.nextOffset });
  assert.notEqual(first.conversations[0].id, second.conversations[0].id);
  assert.equal(second.nextOffset, null);
  assert.equal((await service.searchConversations({ includeArchived: true })).total, 3);
  assert.equal((await service.searchConversations({ query: 'CURRENT TITLE' })).total, 1);
  assert.equal(first.readOnly, true);
  assert.ok(first.excluded.includes('ChatGPT web/cloud history'));
  assert.equal('transcriptPath' in first.conversations[0], false);
  await assert.rejects(service.searchConversations({ query: 'x', limit: 101 }));
  await assert.rejects(service.readConversation({ conversationId: threadId(3) }), /未找到/);
  await assert.rejects(service.readConversation({ conversationId: '../auth.json' }), /标识/);
  await assert.rejects(service.readConversation({ conversationId: threadId(1), path: '/tmp/foo' }), /不支持/);
});

test('transcript resolution rejects path escape and symlinks to credentials', async t => {
  const { catalog, root, sessions, file } = await fixture(t);
  assert.equal(await catalog.transcriptPath({ id: threadId(1), transcriptPath: file }), await fs.realpath(file));
  const outside = path.join(root, 'auth.jsonl'); await fs.writeFile(outside, 'private');
  await assert.rejects(catalog.transcriptPath({ id: threadId(1), transcriptPath: outside }), /目录内/);
  const link = path.join(sessions, 'link.jsonl'); await fs.symlink(outside, link);
  await assert.rejects(catalog.transcriptPath({ id: threadId(1), transcriptPath: link }), /目录内/);
  await assert.rejects(catalog.transcriptPath({ id: threadId(1), transcriptPath: path.join(sessions, 'missing.jsonl') }), /不可用/);
});

test('missing native database is an explicit error, not an empty successful catalog', async () => {
  const catalog = new GptContextCatalog({ databasePath: '/nonexistent/gpt-context-fixture.sqlite' });
  await assert.rejects(catalog.snapshot(), /无法读取/);
});
