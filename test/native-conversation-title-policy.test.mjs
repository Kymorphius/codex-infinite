import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeConversationTabState } from '../src/native-conversation-tab-state.mjs';
import { createNativeConversationTabNormalizer, createNativeConversationTabTitlePolicy, preferNativeConversationTitle } from '../src/native-conversation-tab-titles.mjs';

const id = '019fc616-0dd9-72f1-b7ea-ef1ce8535083';

test('placeholder titles cannot replace a known native conversation title', () => {
  assert.equal(preferNativeConversationTitle('未命名会话', '真实标题'), '真实标题');
  assert.equal(preferNativeConversationTitle('Untitled conversation', '真实标题'), '真实标题');
  assert.equal(preferNativeConversationTitle('重命名后的标题', '真实标题'), '重命名后的标题');

  const state = new NativeConversationTabState();
  state.open({ kind: 'local', id, title: '真实标题' });
  state.open({ kind: 'local', id, title: '未命名会话' });
  assert.equal(state.active().title, '真实标题');
  state.open({ kind: 'local', id, title: '重命名后的标题' });
  assert.equal(state.active().title, '重命名后的标题');
});

test('tab title policy restores a persisted real title and accepts later renames', () => {
  const values = new Map([['codex-control-console.conversation-titles.v1', JSON.stringify({ [id]: '已保存标题' })]]);
  const policy = createNativeConversationTabTitlePolicy({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  assert.equal(policy.resolve('local', id, '未命名会话'), '已保存标题');
  assert.equal(policy.resolve('local', id, '新标题'), '新标题');
  assert.equal(JSON.parse(values.get('codex-control-console.conversation-titles.v1'))[id], '新标题');
  const empty = new Map();
  const fresh = createNativeConversationTabTitlePolicy({ getItem: key => empty.get(key), setItem: (key, value) => empty.set(key, value) });
  assert.equal(fresh.resolve('local', id, '未命名会话'), '未命名会话');
  assert.equal(empty.has('codex-control-console.conversation-titles.v1'), false);
});

test('tab normalization restores a persisted title before rendering saved history', () => {
  const values = new Map([['codex-control-console.conversation-titles.v1', JSON.stringify({ [id]: '已保存标题' })]]);
  const normalize = createNativeConversationTabNormalizer({ getItem: key => values.get(key), setItem() {} }, value => String(value || '').trim(), /^[0-9a-f-]{36}$/i);
  assert.equal(normalize({ kind: 'local', id, title: '未命名会话' }).title, '已保存标题');
});
