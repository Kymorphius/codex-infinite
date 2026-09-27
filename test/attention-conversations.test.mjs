import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { projectAttentionConversations } from '../src/attention-conversations.mjs';
import { AttentionConversationService } from '../src/attention-conversation-service.mjs';
const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
const second = '01a04cd6-8d30-78f1-b2a7-f760d148f745';
const task = { id, title: '检查结果', projectDisplayName: '项目甲', status: 'completed', updatedAt: '2026-09-05T10:00:00Z' };

test('review requires completed and unread; active takes precedence, read and archived disappear', () => {
  assert.equal(projectAttentionConversations([task], [id])[0].section, 'review');
  assert.deepEqual(projectAttentionConversations([task], []), []);
  assert.equal(projectAttentionConversations([{ ...task, status: 'active' }], [id])[0].section, 'active');
  for (const status of ['pending', 'error', 'interrupted']) assert.deepEqual(projectAttentionConversations([{ ...task, status }], [id]), []);
  assert.deepEqual(projectAttentionConversations([{ ...task, archived: true }], [id]), []);
  for (const status of ['completed', 'active']) {
    assert.deepEqual(projectAttentionConversations([{ ...task, status, isSubagent: true }], [id]), []);
  }
  assert.equal(projectAttentionConversations([{ ...task, isSubagent: false }], [id])[0].section, 'review');
});
test('normalizes safe display fields, deduplicates and orders most recent first without mutating membership', () => {
  const original = { ...task, cwd: '/private/path', projectId: 'original', section: '本周' };
  const result = projectAttentionConversations([original, original, { ...task, id: second, status: 'active', updatedAt: '2026-09-05T11:00:00Z' }], [id]);
  assert.deepEqual(result.map(item => item.id), [second, id]);
  assert.equal(original.section, '本周'); assert.equal(result[1].projectLabel, '项目甲');
  assert.equal(JSON.stringify(result).includes('/private'), false);
});
test('service coalesces and caches native reads, excludes archived paths and removes newly read tasks', async () => {
  const archivedSessionRoot = path.resolve('archive'); let now = 100; let reads = 0; let unreadReads = 0;
  let unread = [id, second];
  const service = new AttentionConversationService({ archivedSessionRoot, clock: () => now,
    unreadStateProvider: { readUnreadIds: async () => { unreadReads += 1; return unread; } },
    taskAdapter: { listTasks: async () => {
      reads += 1; return { status: 'connected', tasks: [task, { ...task, id: second, sourceFile: path.join(archivedSessionRoot, 'old.jsonl') }] };
    } }
  });
  const snapshots = await Promise.all([service.read(), service.read()]);
  assert.equal(reads, 1); assert.equal(unreadReads, 1);
  assert.deepEqual(snapshots[0].items.map(x => x.id), [id]);
  assert.equal(snapshots[0], snapshots[1]);
  assert.equal(snapshots[0].stale, false);
  unread = [];
  assert.equal((await service.read()).items.length, 1); assert.equal(unreadReads, 1);
  now += 5001;
  assert.deepEqual(await service.read(), { items: [], stale: false, statuses: { [id]: { status: 'completed', unread: false } } });
  assert.equal(reads, 2); assert.equal(unreadReads, 2);
});
test('historical active markers require live confirmation and live completion can enter review', async () => {
  let status = 'active'; let unread = [second];
  const service = new AttentionConversationService({ cacheMs: 0,
    unreadStateProvider: { readUnreadIds: async () => unread },
    taskAdapter: { listTasks: async () => ({ tasks: [{ ...task, status: 'active' }, { ...task, id: second, status: 'active' }] }) },
    runtimeStatusProvider: { readThreadStatuses: async () => new Map([[second, status]]) }
  });
  assert.deepEqual((await service.read()).items.map(x => [x.id, x.section]), [[second, 'active']]);
  status = 'completed';
  const result = await service.read(); assert.deepEqual(result.items.map(x => [x.id, x.section]), [[second, 'review']]);
  unread = [];
  assert.deepEqual(await service.read(), { items: [], stale: false, statuses: { [id]: { status: 'unknown', unread: false }, [second]: { status: 'completed', unread: false } } });
});

test('empty confirmed runtime is valid while a runtime failure preserves the last snapshot as stale', async () => {
  let failed = false;
  const service = new AttentionConversationService({ cacheMs: 0,
    unreadStateProvider: { readUnreadIds: async () => [id] },
    taskAdapter: { listTasks: async () => ({ tasks: [task, { ...task, id: second, status: 'active' }] }) },
    runtimeStatusProvider: { readThreadStatuses: async options => {
      assert.equal(options.strict, true);
      if (failed) throw Error('disconnected');
      return new Map();
    } }
  });
  const result = await service.read(); assert.equal(result.stale, false);
  assert.deepEqual(result.items.map(x => [x.id, x.section]), [[id, 'review']]);
  failed = true; const stale = await service.read(); assert.equal(stale.stale, true); assert.deepEqual(stale.items, result.items);
});

test('native runtime strict reads distinguish an unloaded window from failed status retrieval', async () => {
  const { NativeConversationAdapter } = await import('../src/native-conversation-adapter.mjs');
  const adapter = new NativeConversationAdapter({});
  let value = []; let closed = 0;
  adapter.connect = async () => ({ evaluate: async () => value, close: async () => { closed += 1; } });
  assert.equal((await adapter.readThreadStatuses({ strict: true })).size, 0);
  value = undefined;
  await assert.rejects(adapter.readThreadStatuses({ strict: true }), /unavailable/);
  assert.equal((await adapter.readThreadStatuses()).size, 0);
  assert.equal(closed, 3);
});

test('unread provider failures and malformed state preserve the last snapshot as stale', async () => {
  let unread = [id]; let failed = false;
  const service = new AttentionConversationService({ cacheMs: 0,
    unreadStateProvider: { readUnreadIds: async () => {
      if (failed) throw Error('native read state unavailable');
      return unread;
    } },
    taskAdapter: { listTasks: async () => ({ tasks: [task, { ...task, id: second, latestInputSource: 'codex' }] }) }
  });
  const initial = await service.read();
  assert.deepEqual(initial.items.map(x => [x.id, x.section]), [[id, 'review'], [second, 'codex']]);
  failed = true;
  assert.deepEqual(await service.read(), { ...initial, stale: true });
  failed = false;
  for (unread of [undefined, null, {}, 'invalid', [null], [id, 'invalid']]) {
    assert.deepEqual(await service.read(), { ...initial, stale: true });
  }
  unread = [];
  const cleared = await service.read();
  assert.equal(cleared.stale, false);
  assert.deepEqual(cleared.items.map(x => x.section), ['codex']);
});

test('missing native unread provider cannot masquerade as confirmed empty state', async () => {
  for (const unreadStateProvider of [undefined, {}, { readUnreadIds: 'invalid' }]) {
    const service = new AttentionConversationService({ unreadStateProvider,
      taskAdapter: { listTasks: async () => ({ tasks: [task] }) }
    });
    assert.deepEqual(await service.read(), { items: [], stale: true });
  }
  const service = new AttentionConversationService({
    unreadStateProvider: { readUnreadIds: async () => [] },
    taskAdapter: { listTasks: async () => ({ tasks: [task] }) }
  });
  assert.deepEqual(await service.read(), { items: [], stale: false, statuses: { [id]: { status: 'completed', unread: false } } });
});
