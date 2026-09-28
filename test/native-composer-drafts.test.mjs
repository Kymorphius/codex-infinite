import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { composerDraftText, createComposerDraftReader } from '../src/native-composer-drafts.mjs';
import { AttentionConversationService } from '../src/attention-conversation-service.mjs';

const a = '019ff5a0-ef36-7991-9086-04c348856e5d', b = '01a0c7ef-4924-7d62-b627-abf81715d707', c = '01a038d1-94ef-7b33-b155-4f67c279695f';

test('draft text is read from plain, prompt and rich-document shapes', () => {
  assert.equal(composerDraftText('可以，那什么样的算是读了呢？'), '可以，那什么样的算是读了呢？');
  assert.equal(composerDraftText({ prompt: '我们网络', pullRequestChecks: [] }), '我们网络');
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '修复一下' }, { type: 'text', marks: [{ type: 'code' }], text: 'codex-computer-use' }] }] };
  assert.equal(composerDraftText({ prompt: { document } }), '修复一下codex-computer-use');
  assert.equal(composerDraftText({ prompt: '   ' }), '');
  assert.equal(composerDraftText({ prompt: null }), '');
});

test('reader maps local thread drafts, ignores other scopes, and reparses only on change', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'composer-drafts-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, '.codex-global-state.json');
  const write = drafts => fs.writeFile(file, JSON.stringify({ other: 1, 'electron-persisted-atom-state': { 'composer-prompt-drafts-v2': drafts } }));
  await write({ ['local:' + a]: '第一条', ['client-new-thread:' + b]: '新线程不算', ['local:' + c]: { prompt: '' } });
  const read = createComposerDraftReader({ filePath: file });
  assert.deepEqual([...await read()], [[a, '第一条']]);
  await write({ ['local:' + b.toUpperCase()]: { prompt: '改了' } }); await fs.utimes(file, new Date(), new Date(Date.now() + 5000));
  assert.deepEqual([...await read()], [[b, '改了']]);
  await fs.rm(file);
  assert.deepEqual([...await read()], [], 'a missing file means no drafts');
});

test('attention statuses carry a draft only when one exists and a failing reader is ignored', async () => {
  const task = { id: a, status: 'completed', title: 'x' };
  const base = { cacheMs: 0, unreadStateProvider: { readUnreadIds: async () => [] }, taskAdapter: { listTasks: async () => ({ tasks: [task, { ...task, id: b }] }) } };
  const withDraft = new AttentionConversationService({ ...base, draftReader: async () => new Map([[a, '修复一下']]) });
  const { statuses } = await withDraft.read();
  assert.deepEqual(statuses[a], { status: 'completed', unread: false, draft: '修复一下' });
  assert.deepEqual(statuses[b], { status: 'completed', unread: false });
  const failing = new AttentionConversationService({ ...base, draftReader: async () => { throw Error('unreadable'); } });
  const snapshot = await failing.read();
  assert.equal(snapshot.stale, false); assert.deepEqual(snapshot.statuses[a], { status: 'completed', unread: false });
});
