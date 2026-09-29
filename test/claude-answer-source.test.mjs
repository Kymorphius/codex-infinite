import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { latestClaudeAnswer, createClaudeAnswerSource } from '../src/claude-answer-source.mjs';

const line = record => JSON.stringify(record);
const assistant = (uuid, messageId, stop, ...content) => line({ type: 'assistant', uuid, timestamp: `T${uuid}`, message: { id: messageId, stop_reason: stop, content } });
const text = value => ({ type: 'text', text: value });

test('the answer is the last end_turn message: tools, thinking and side chains are excluded', () => {
  const transcript = [
    assistant('a1', 'm1', 'end_turn', text('旧回答')),
    line({ type: 'user', uuid: 'u2', message: { content: '再想想' } }),
    assistant('a2', 'm2', null, { type: 'thinking', thinking: '私有推理' }),
    assistant('a3', 'm2', null, text('先说结论')),
    assistant('a4', 'm2', 'tool_use', { type: 'tool_use', name: 'Read' }),
    assistant('a5', 'm3', 'end_turn', text('最终结论'), { type: 'thinking', thinking: 'x' }),
    line({ type: 'assistant', isSidechain: true, uuid: 'a6', message: { id: 'm9', stop_reason: 'end_turn', content: [text('子代理的回答')] } }),
    '{"partial'
  ].join('\n');
  assert.deepEqual(latestClaudeAnswer(transcript), { turnId: 'a5', text: '最终结论', at: 'Ta5' });
});

test('multi-record messages are joined and a transcript without a finished answer yields null', () => {
  const joined = [assistant('b1', 'm1', null, text('第一段')), assistant('b2', 'm1', 'end_turn', text('第二段'))].join('\n');
  assert.equal(latestClaudeAnswer(joined).text, '第一段\n第二段');
  assert.equal(latestClaudeAnswer(assistant('c1', 'm1', 'tool_use', { type: 'tool_use' })), null);
  assert.equal(latestClaudeAnswer(''), null);
});

test('adapter finds the transcript under ~/.claude/projects, follows continuation ids and refuses symlink escapes', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-answer-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const projects = path.join(home, '.claude', 'projects', '-proj');
  await fs.mkdir(projects, { recursive: true });
  await fs.writeFile(path.join(projects, 'new.jsonl'), assistant('n1', 'm1', 'end_turn', text('续接会话的回答')) + '\n');
  await fs.writeFile(path.join(projects, 'old.jsonl'), assistant('o1', 'm1', 'end_turn', text('旧会话的回答')) + '\n');
  const outside = path.join(home, 'outside.jsonl');
  await fs.writeFile(outside, assistant('x1', 'm1', 'end_turn', text('越界')) + '\n');
  await fs.symlink(outside, path.join(projects, 'evil.jsonl'));
  const latest = createClaudeAnswerSource({ userHome: home, sessionIds: async id => id === 'old' ? ['new', 'old'] : [id] });
  assert.equal((await latest('old')).text, '续接会话的回答');
  assert.equal(await latest('missing'), null);
  assert.equal(await latest('evil'), null);
});
