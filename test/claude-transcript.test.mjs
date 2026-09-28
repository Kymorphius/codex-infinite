import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createClaudeTranscriptReader, scanClaudeTranscript, claudeTitleText, claudeUserText } from '../src/claude-transcript.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { withTerminalSentSearch } from '../src/sent-message-search-composite.mjs';

const line = value => JSON.stringify(value) + '\n';
const said = (sessionId, content, timestamp, extra = {}) => line({ type: 'user', sessionId, timestamp, message: { role: 'user', content }, ...extra });

test('only messages the person typed count, and custom titles beat generated ones', () => {
  const id = randomUUID(), at = '2026-09-28T01:00:00.000Z';
  assert.equal(claudeUserText({ type: 'user', sessionId: id, message: { content: '你好' } }, id), '你好');
  assert.equal(claudeUserText({ type: 'user', sessionId: id, message: { content: [{ type: 'text', text: '看图' }, { type: 'image' }] } }, id), '看图');
  for (const record of [{ isMeta: true }, { toolUseResult: {} }, { message: { content: [{ type: 'tool_result' }] } }, { message: { content: '<command-name>/help</command-name>' } }, { sessionId: 'other' }])
    assert.equal(claudeUserText({ type: 'user', sessionId: id, message: { content: 'x' }, ...record }, id), '');
  const text = line({ type: 'ai-title', aiTitle: '旧', sessionId: id }) + line({ type: 'ai-title', aiTitle: '新\n标题', sessionId: id }) + said(id, '第一句', at)
    + said(id, 'tool', '2026-09-28T02:00:00.000Z', { toolUseResult: {} }) + line({ type: 'continued-in', sessionId: id, continuedInSessionId: 'next' }) + '{broken\n';
  const found = scanClaudeTranscript(text, id);
  assert.equal(claudeTitleText(found), '新 标题'); assert.equal(found.lastUserAt, at); assert.deepEqual(found.continued, ['next']);
  scanClaudeTranscript(line({ type: 'custom-title', customTitle: '我的名字', sessionId: id }), id, found);
  assert.equal(claudeTitleText(found), '我的名字');
});

async function home(t) {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-transcript-'));
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const directory = path.join(userHome, '.claude', 'projects', '-work'); await fs.mkdir(directory, { recursive: true });
  const file = id => path.join(directory, `${id}.jsonl`);
  const touch = (id, ms) => fs.utimes(file(id), new Date(ms), new Date(ms));
  return { userHome, directory, file, touch };
}

test('reader follows continued-in to the most recently written transcript and advances incrementally', async t => {
  const { userHome, file, touch } = await home(t), origin = randomUUID(), stale = randomUUID(), live = randomUUID();
  const reader = createClaudeTranscriptReader({ userHome });
  assert.deepEqual(await reader.summary(origin), { title: '', lastUserMessageAt: null, ids: [origin], resumeId: null });
  await fs.writeFile(file(origin), line({ type: 'ai-title', aiTitle: '原标题', sessionId: origin }) + said(origin, '早', '2026-09-28T01:00:00.000Z')
    + line({ type: 'continued-in', sessionId: origin, continuedInSessionId: stale }) + line({ type: 'continued-in', sessionId: origin, continuedInSessionId: live })
    + line({ type: 'continued-in', sessionId: origin, continuedInSessionId: randomUUID() }));
  await fs.writeFile(file(stale), said(stale, '旧分支', '2026-09-28T02:00:00.000Z'));
  await fs.writeFile(file(live), said(live, '现在', '2026-09-28T03:00:00.000Z'));
  await touch(origin, 1000); await touch(stale, 2000); await touch(live, 3000);
  const first = await reader.summary(origin);
  assert.deepEqual({ ...first, ids: first.ids.slice(0, 3) }, { title: '原标题', lastUserMessageAt: '2026-09-28T03:00:00.000Z', ids: [origin, stale, live], resumeId: live }, 'title falls back to the origin; resume targets the live file');
  assert.equal(first.ids.length, 4, 'a missing continuation id still belongs to the chain');
  await fs.appendFile(file(live), line({ type: 'custom-title', customTitle: '改名', sessionId: live }) + JSON.stringify({ type: 'user', sessionId: live, timestamp: '2026-09-28T04:00:00.000Z', message: { content: '半行' } }));
  await touch(live, 4000);
  const renamed = await reader.summary(origin);
  assert.deepEqual([renamed.title, renamed.lastUserMessageAt], ['改名', '2026-09-28T03:00:00.000Z'], 'an unterminated line is not consumed');
  assert.deepEqual(await reader.search(origin, 'XIAN'), null);
  assert.deepEqual(await reader.search(origin, '现在'), { excerpt: '现在', at: '2026-09-28T03:00:00.000Z' });
  assert.equal(await reader.search(origin, '旧分支'), null, 'search reads the live continuation only');
  await assert.rejects(reader.summary('../escape'), { statusCode: 400 });
});

test('continuation pointers never leave the projects root', async t => {
  const { userHome, directory, file } = await home(t), origin = randomUUID(), outside = randomUUID();
  const external = path.join(userHome, 'outside'); await fs.mkdir(external);
  await fs.writeFile(path.join(external, `${outside}.jsonl`), said(outside, '外部', '2026-09-28T09:00:00.000Z'));
  await fs.symlink(path.join(external, `${outside}.jsonl`), path.join(directory, `${outside}.jsonl`));
  await fs.writeFile(file(origin), said(origin, '里面', '2026-09-28T01:00:00.000Z') + line({ type: 'continued-in', sessionId: origin, continuedInSessionId: outside })
    + line({ type: 'continued-in', sessionId: origin, continuedInSessionId: '../../etc/passwd' }));
  const reader = createClaudeTranscriptReader({ userHome });
  assert.equal((await reader.summary(origin)).lastUserMessageAt, '2026-09-28T01:00:00.000Z');
});

test('service projects Claude titles and send times, searches sent messages and merges with native results', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-service-'));
  const terminalService = new TerminalService({ userHome: directory, defaultCwd: directory, spawnProcess: async () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  t.after(async () => { await terminalService.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
  const summaries = new Map(), matches = new Map();
  const service = new TerminalConversationService({ terminalService, filePath: path.join(directory, 'registry.json'), deviceId: 'mac',
    claudeTranscripts: { summary: async id => { const value = summaries.get(id); if (value instanceof Error) throw value; return value || { title: '', lastUserMessageAt: null }; },
      search: async id => matches.get(id) || null } });
  const claude = await service.create({ cwd: directory, kind: 'claude' }), shell = await service.create({ cwd: directory, kind: 'shell' });
  summaries.set(claude.id, { title: '看板会话交互', lastUserMessageAt: '2026-09-28T03:00:00.000Z' });
  const listed = (await service.list()).conversations;
  assert.equal(listed.find(item => item.id === claude.id).title, '看板会话交互');
  assert.equal(listed.find(item => item.id === claude.id).lastUserMessageAt, '2026-09-28T03:00:00.000Z');
  assert.equal(listed.find(item => item.id === shell.id).lastUserMessageAt, undefined);
  const renamed = await service.update({ id: claude.id, expectedRevision: claude.revision, title: '我起的名字' });
  assert.equal(renamed.title, '我起的名字'); assert.equal(renamed.lastUserMessageAt, '2026-09-28T03:00:00.000Z');
  const other = await service.create({ cwd: directory, kind: 'claude' }); summaries.set(other.id, Error('unreadable'));
  assert.equal((await service.open({ id: other.id })).title, 'Claude CLI', 'unreadable transcript keeps the stored title');
  matches.set(claude.id, { excerpt: '终端里说过', at: '2026-09-28T02:00:00.000Z' });
  assert.deepEqual(await service.searchSent('说过'), { items: [{ kind: 'terminal', id: claude.id, deviceId: 'mac', title: '我起的名字', excerpt: '终端里说过', at: '2026-09-28T02:00:00.000Z' }], incomplete: false });
  const base = { index: null, prepare: async () => {}, search: async () => ({ items: [{ id: 'native-old', title: 'A', excerpt: 'x', at: '2026-09-28T01:00:00.000Z' }, { id: 'native-new', title: 'B', excerpt: 'y', at: '2026-09-28T05:00:00.000Z' }], incomplete: false }) };
  const merged = await withTerminalSentSearch(base, service).search('说过');
  assert.deepEqual(merged.items.map(item => item.id), ['native-new', claude.id, 'native-old']);
  const failing = await withTerminalSentSearch(base, { searchSent: async () => { throw Error('down'); } }).search('说过');
  assert.equal(failing.items.length, 2); assert.equal(failing.incomplete, true, 'a terminal failure marks the result incomplete');
});
