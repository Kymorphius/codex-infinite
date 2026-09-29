import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeMirrorEntries, codexPromptText, readClaudeMirror } from '../src/claude-mirror.mjs';
import { mirrorStatusText } from '../public/features/terminal/mirror.js';

const sid = '11111111-1111-4111-8111-111111111111';
const user = (content, extra = {}) => ({ type: 'user', sessionId: sid, uuid: 'u' + Math.random(), timestamp: '2026-09-29T15:00:00Z', message: { role: 'user', content }, ...extra });
const assistant = content => ({ type: 'assistant', sessionId: sid, uuid: 'a1', timestamp: '2026-09-29T15:00:01Z', message: { role: 'assistant', content } });
const routerPrompt = JSON.stringify({ history_notice: 'x', input: [
  { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'earlier reply' }] },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] },
  { type: 'message', role: 'user', content: [{ type: 'input_text', text: '重启\n' }] }] });

test('Router prompts show only what was typed in Codex; one-shot and terminal messages are yours', () => {
  assert.equal(codexPromptText(routerPrompt), '重启');
  assert.equal(codexPromptText('plain text'), null);
  assert.deepEqual(claudeMirrorEntries(user(routerPrompt, { entrypoint: 'sdk-cli' }), sid).map(entry => [entry.role, entry.text]), [['codex', '重启']]);
  assert.deepEqual(claudeMirrorEntries(user('from the mirror', { entrypoint: 'sdk-cli' }), sid).map(entry => entry.role), ['you']);
  assert.deepEqual(claudeMirrorEntries(user([{ type: 'text', text: 'typed in terminal' }], { entrypoint: 'cli' }), sid).map(entry => entry.role), ['you']);
});

test('replies and tool calls are shown; thinking, results, meta, sidechains and other sessions are not', () => {
  const entries = claudeMirrorEntries(assistant([{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: 'answer' },
    { type: 'tool_use', name: 'Bash', input: { description: 'List files', command: 'ls' } }]), sid);
  assert.deepEqual(entries.map(entry => [entry.role, entry.text]), [['claude', 'answer'], ['tool', 'Bash · List files']]);
  assert.deepEqual(claudeMirrorEntries(user([{ type: 'tool_result', content: 'output' }]), sid), []);
  assert.deepEqual(claudeMirrorEntries(user('<command-name>/clear</command-name>'), sid), []);
  assert.deepEqual(claudeMirrorEntries(user('meta', { isMeta: true }), sid), []);
  assert.deepEqual(claudeMirrorEntries({ ...assistant([{ type: 'text', text: 'sub' }]), isSidechain: true }, sid), []);
  assert.deepEqual(claudeMirrorEntries({ ...assistant([{ type: 'text', text: 'other' }]), sessionId: 'other' }, sid), []);
});

test('reading follows a cursor, waits for complete lines, and restarts for another session or a shrunk file', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-mirror-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, `${sid}.jsonl`), line = value => JSON.stringify(value) + '\n';
  await fs.writeFile(file, 'partial-first-line-without-session\n' + line(user('one')) + line(assistant([{ type: 'text', text: 'two' }])));
  const first = await readClaudeMirror({ file, sessionId: sid, tailBytes: 1 << 20 });
  assert.deepEqual(first.entries.map(entry => entry.text), ['one', 'two']);
  const half = line(user('three'));
  await fs.appendFile(file, half.slice(0, 20));
  const pending = await readClaudeMirror({ file, sessionId: sid, cursor: first.cursor });
  assert.deepEqual(pending.entries, []); assert.equal(pending.cursor.offset, first.cursor.offset, 'an incomplete line is not consumed');
  await fs.appendFile(file, half.slice(20));
  assert.deepEqual((await readClaudeMirror({ file, sessionId: sid, cursor: pending.cursor })).entries.map(entry => entry.text), ['three']);
  const tail = await readClaudeMirror({ file, sessionId: sid, cursor: { sessionId: 'another', offset: 5 }, tailBytes: 1 << 20 });
  assert.equal(tail.entries.length, 3, 'another session starts from the tail');
  const shrunk = await readClaudeMirror({ file, sessionId: sid, cursor: { sessionId: sid, offset: 10 ** 9 }, tailBytes: 1 << 20 });
  assert.equal(shrunk.entries.length, 3);
  const missing = await readClaudeMirror({ file: path.join(dir, 'gone.jsonl'), sessionId: sid });
  assert.deepEqual(missing.entries, []);
});

test('status text names who is using the session', () => {
  assert.equal(mirrorStatusText({ occupiedBy: 'codex' }), 'Codex 正在用这个会话回复…');
  assert.equal(mirrorStatusText({ turn: { state: 'waiting' }, occupiedBy: 'codex' }), '等 Codex 这一轮结束后发送…');
  assert.equal(mirrorStatusText({ turn: { state: 'running' } }), 'Claude 正在回复…');
  assert.equal(mirrorStatusText({ turn: { state: 'failed', error: 'boom' } }), 'boom');
  assert.equal(mirrorStatusText({}), '');
});
