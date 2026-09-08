import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionJsonl } from '../src/task-adapter.mjs';
import { inputSourceFromSessionRecord } from '../src/session-input-source.mjs';
import { projectAttentionConversations } from '../src/attention-conversations.mjs';
const id = '01a04cd6-8d30-78f1-b2a7-f760d148f744';
const envelope = `<codex_delegation>\n<source_thread_id>${id}</source_thread_id>\n<input>检查项目</input>\n</codex_delegation>`;
const delegated = { type: 'response_item', payload: { type: 'function_call_output', namespace: 'codex_app', name: 'send_message_to_thread', output: envelope } };
const user = text => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
const parse = records => parseSessionJsonl([{ type: 'session_meta', payload: { id, originator: 'codex_work_desktop' } }, ...records].map(JSON.stringify).join('\n'));
test('latest actual input decides ownership, assistant output and context do not replace it', () => {
  const context = user('# AGENTS.md instructions for /project');
  const final = { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final' } };
  assert.equal(parse([user('开始'), delegated, context, final]).latestInputSource, 'codex');
  assert.equal(parse([delegated, user('我来接手'), final]).latestInputSource, 'user');
  assert.equal(parse([user('开始'), delegated]).latestInputSource, 'codex');
  assert.equal(parse([]).latestInputSource, null);
});
test('recognizes native received outputs and legacy envelopes without matching quoted or unrelated tool text', () => {
  assert.equal(inputSourceFromSessionRecord(delegated), 'codex');
  assert.equal(inputSourceFromSessionRecord(user(envelope)), 'codex');
  assert.equal(inputSourceFromSessionRecord({ type: 'event_msg', payload: { type: 'item_completed', item: { ...delegated.payload, type: 'FunctionCallOutput' } } }), 'codex');
  assert.equal(inputSourceFromSessionRecord({ ...delegated, payload: { ...delegated.payload, namespace: 'other' } }), null);
  assert.equal(inputSourceFromSessionRecord({ ...delegated, payload: { ...delegated.payload, type: 'function_call' } }), null);
  assert.equal(inputSourceFromSessionRecord(user('举例：' + envelope)), 'user');
  const context = user('环境'); context.payload.internal_chat_message_metadata_passthrough = { content_item_kinds: ['environments.environment_context'] };
  assert.equal(inputSourceFromSessionRecord(context), null);
});
test('Codex tasks are exclusive across runtime/read states and user resumption restores usual filters', () => {
  for (const status of ['active', 'completed', 'unknown', 'error']) {
    const task = { id, latestInputSource: 'codex', status };
    for (const unread of [[], [id]]) assert.deepEqual(projectAttentionConversations([task], unread).map(x => x.section), ['codex']);
    assert.deepEqual(projectAttentionConversations([{ ...task, archived: true }], [id]), []);
  }
  assert.equal(projectAttentionConversations([{ id, latestInputSource: 'user', status: 'active' }], [id])[0].section, 'active');
  assert.equal(projectAttentionConversations([{ id, latestInputSource: 'user', status: 'completed' }], [id])[0].section, 'review');
});
