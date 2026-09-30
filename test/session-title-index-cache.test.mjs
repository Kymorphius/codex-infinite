import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionTitleIndex, createCodexTitleLookup } from '../src/session-title-index.mjs';

function fixture() {
  let stat = { dev: 1, ino: 2, ctimeMs: 3, mtimeMs: 4, size: 50 }, title = '原标题', missing = false, readFails = false;
  const calls = { stat: 0, read: 0 };
  const fsImpl = {
    async stat() { calls.stat++; if (missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { ...stat }; },
    async readFile() { calls.read++; if (readFails) throw new Error('temporary read failure'); return JSON.stringify({ id: 'thread', thread_name: title }); }
  };
  return { fsImpl, calls, change(next = {}) { stat = { ...stat, ...next }; }, title(value) { title = value; },
    missing(value) { missing = value; }, readFails(value) { readFails = value; } };
}

test('title index coalesces concurrent reads, reuses unchanged parse and returns defensive maps', async () => {
  const f = fixture(), index = new SessionTitleIndex({ filePath: '/titles.jsonl', fsImpl: f.fsImpl });
  const values = await Promise.all(Array.from({ length: 8 }, () => index.read()));
  assert.deepEqual(f.calls, { stat: 1, read: 1 });
  assert.equal(values[0].get('thread'), '原标题');
  values[0].set('thread', 'caller mutation'); values[1].clear();
  assert.equal(values[2].get('thread'), '原标题');
  assert.equal((await index.read()).get('thread'), '原标题');
  assert.deepEqual(f.calls, { stat: 2, read: 1 });
});

test('title index observes change time and inode replacement even with identical size and mtime', async () => {
  const f = fixture(), index = new SessionTitleIndex({ filePath: '/titles.jsonl', fsImpl: f.fsImpl });
  await index.read();
  f.change({ ctimeMs: 5 }); f.title('修改后的标题');
  assert.equal((await index.read()).get('thread'), '修改后的标题');
  f.change({ ino: 9 }); f.title('替换后的标题');
  assert.equal((await index.read()).get('thread'), '替换后的标题');
  assert.equal(f.calls.read, 3);
});

test('deletion and read failures clear cached titles and remain retryable', async () => {
  const f = fixture(), index = new SessionTitleIndex({ filePath: '/titles.jsonl', fsImpl: f.fsImpl });
  await index.read();
  f.missing(true); assert.equal((await index.read()).size, 0);
  f.missing(false); f.title('删除后重建');
  assert.equal((await index.read()).get('thread'), '删除后重建');
  assert.equal(f.calls.read, 2, 'recreation with an identical stub signature cannot retain deleted contents');
  f.change({ size: 60 }); f.readFails(true); assert.equal((await index.read()).size, 0);
  f.readFails(false); f.title('重试成功');
  assert.equal((await index.read()).get('thread'), '重试成功');
  assert.equal(f.calls.read, 4);
});

test('companion title lookup uses the same coalesced replacement-aware reader', async () => {
  const f = fixture(), lookup = createCodexTitleLookup({ filePath: '/titles.jsonl', fsImpl: f.fsImpl });
  assert.deepEqual(await Promise.all([lookup('THREAD'), lookup('thread')]), ['原标题', '原标题']);
  assert.deepEqual(f.calls, { stat: 1, read: 1 });
  f.change({ ino: 30 }); f.title('伴生会话新标题');
  assert.equal(await lookup('thread'), '伴生会话新标题');
  f.missing(true); assert.equal(await lookup('thread'), '');
  f.missing(false); f.title('伴生重建标题'); assert.equal(await lookup('thread'), '伴生重建标题');
});
