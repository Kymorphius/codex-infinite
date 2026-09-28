import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeUserText, createClaudeTranscriptReader } from '../src/claude-transcript.mjs';
import { createCodexTitleLookup } from '../src/session-title-index.mjs';
import { TerminalService } from '../src/terminal-service.mjs';
import { TerminalConversationService } from '../src/terminal-conversation-service.mjs';
import { installNativeRecentSentMenu, mergeRecentSentRecords } from '../src/native-recent-sent-conversations.mjs';
import { installNativeRecentConversationMenu, NATIVE_RECENT_CONVERSATION_STYLE } from '../src/native-recent-conversations.mjs';
import { createNativeConversationTabNormalizer } from '../src/native-conversation-tab-titles.mjs';

const THREAD = '01a0be7e-3c97-76a3-b5da-36c782facc71', CURRENT = '6befd8ba-bb69-4270-a169-3a29c1b009d3', OLD = 'ab11ae12-3acd-4b7c-be86-ac1f6851ac2c';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const user = (sessionId, content, extra = {}) => JSON.stringify({ type: 'user', sessionId, timestamp: '2026-09-28T10:00:00.000Z', message: { role: 'user', content }, ...extra });

test('prompts a program sent through claude -p are not messages the person typed', () => {
  assert.equal(claudeUserText(JSON.parse(user(CURRENT, '{"instructions":"You are Codex…"}', { entrypoint: 'sdk-cli' })), CURRENT), '');
  assert.equal(claudeUserText(JSON.parse(user(CURRENT, '继续看一下', { entrypoint: 'cli' })), CURRENT), '继续看一下');
});

test('a companion transcript with only relayed prompts has no sent time, no generated title and no search hits', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-transcript-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const dir = path.join(home, '.claude', 'projects', 'companion'); await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${CURRENT}.jsonl`), [
    user(CURRENT, '{"instructions":"You are Codex, an agent"}', { entrypoint: 'sdk-cli' }),
    JSON.stringify({ type: 'ai-title', sessionId: CURRENT, aiTitle: 'Codex agent instructions' }), ''].join('\n'));
  const reader = createClaudeTranscriptReader({ userHome: home });
  const summary = await reader.summary(CURRENT);
  assert.equal(summary.lastUserMessageAt, null); assert.equal(summary.customTitle, '');
  assert.equal(await reader.search(CURRENT, 'You are Codex'), null);
  await fs.appendFile(path.join(dir, `${CURRENT}.jsonl`), [user(CURRENT, '我在终端里问一句', { entrypoint: 'cli', timestamp: '2026-09-28T11:00:00.000Z' }),
    JSON.stringify({ type: 'custom-title', sessionId: CURRENT, customTitle: '路由排查' }), ''].join('\n'));
  const typed = await reader.summary(CURRENT);
  assert.equal(typed.lastUserMessageAt, '2026-09-28T11:00:00.000Z'); assert.equal(typed.customTitle, '路由排查');
});

test('the Codex title lookup re-reads only when the index changes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-titles-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session_index.jsonl');
  await fs.writeFile(file, JSON.stringify({ id: THREAD, thread_name: '增加 codex-router 项目' }) + '\n');
  const titleOf = createCodexTitleLookup({ filePath: file });
  assert.equal(await titleOf(THREAD), '增加 codex-router 项目'); assert.equal(await titleOf(OLD), '');
  await fs.appendFile(file, JSON.stringify({ id: THREAD, thread_name: '改名后的会话' }) + '\n');
  assert.equal(await titleOf(THREAD), '改名后的会话');
  assert.equal(await createCodexTitleLookup({ filePath: path.join(dir, 'missing') })(THREAD), '');
});

test('companions carry their Codex conversation name, a /rename wins, and a replaced session is hidden', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'companion-naming-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const terminalService = new TerminalService({ userHome: root, defaultCwd: root, spawnProcess: async () => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill: async () => {}, write() {}, resize() {} }) });
  t.after(() => terminalService.dispose());
  let current = OLD, custom = '';
  const conversations = new TerminalConversationService({ terminalService, deviceId: 'mac', filePath: path.join(root, 'registry.json'),
    companions: { list: async () => [{ threadId: THREAD, sessionId: current, cwd: root }] }, claudeOccupancy: async () => null,
    codexTitle: async (id) => (id === THREAD ? '增加 codex-router 项目' : ''),
    claudeTranscripts: { summary: async (id) => ({ title: 'Codex agent instructions', customTitle: custom, lastUserMessageAt: null, ids: [id] }), search: async () => ({ excerpt: 'x', at: null }) } });
  let listed = (await conversations.list()).conversations;
  assert.deepEqual(listed.map((item) => [item.id, item.title]), [[OLD, '增加 codex-router 项目']], 'never the generated title');
  current = CURRENT; listed = (await conversations.list()).conversations;
  assert.deepEqual(listed.map((item) => item.id), [CURRENT], 'the replaced companion is kept but not shown');
  assert.deepEqual((await conversations.searchSent('x')).items.map((item) => item.id), [CURRENT]);
  custom = '路由排查'; assert.equal((await conversations.open({ id: CURRENT })).title, '路由排查');
});

test('最近发送 lists a companion only after you typed in it, tagged 伴生; tabs keep the link', () => {
  const record = (lastUserMessageAt) => ({ provider: 'terminal', kind: 'claude', id: CURRENT, deviceId: 'mac', title: '增加 codex-router 项目', cwd: '/x', companionOf: THREAD, lastUserMessageAt });
  assert.deepEqual(mergeRecentSentRecords([], [record(null)]), [], 'relayed Codex turns are already the Codex row');
  const [merged] = mergeRecentSentRecords([], [record('2026-09-28T11:00:00.000Z')]);
  assert.equal(merged.companionOf, THREAD);
  assert.doesNotMatch(installNativeRecentSentMenu.toString(), /· Claude/, 'the kind is a tag, the detail is only the time');
  const menu = installNativeRecentConversationMenu.toString();
  assert.match(menu, /tab\.companionOf \? "伴生" : "CLI"/); assert.match(menu, /ccc-native-recent-engine/);
  assert.match(NATIVE_RECENT_CONVERSATION_STYLE, /\.ccc-native-recent-engine\{[^}]*color:#f2bd5c/);
  const normalize = createNativeConversationTabNormalizer({ getItem: () => null, setItem() {} }, (value, max) => String(value || '').slice(0, max), UUID);
  assert.equal(normalize({ kind: 'terminal', id: CURRENT, deviceId: 'mac', engine: 'claude', companionOf: THREAD }).companionOf, THREAD);
  assert.equal(normalize({ kind: 'terminal', id: CURRENT, deviceId: 'mac', engine: 'claude', companionOf: 'x' }).companionOf, undefined);
});
