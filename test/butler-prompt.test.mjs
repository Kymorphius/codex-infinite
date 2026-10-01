import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTLER_ENGINE, buildButlerAgentsMd } from '../src/butler-prompt.mjs';

test('butler engine policy is the non-native Router Opus route', () => {
  assert.deepEqual(BUTLER_ENGINE, { provider: 'claude-router', family: 'opus', effort: 'auto', nativeTools: false });
  assert.ok(Object.isFrozen(BUTLER_ENGINE));
});

test('AGENTS.md is versioned, read-only, and teaches the link format and data policy', () => {
  const text = buildButlerAgentsMd({ cwd: '/home/.ccc/butler', sessionRoots: ['/home/.codex/sessions', '', null] });
  assert.match(text, /^<!-- butler-agents v1 -->\n/);
  assert.match(text, /严格只读/);
  assert.match(text, /不写任何文件/);
  assert.match(text, /\.\/overview\.md/);
  assert.match(text, /capturedAt/);
  assert.match(text, /\.\/overview\.json/);
  assert.match(text, /list_threads/);
  assert.match(text, /`\/home\/\.codex\/sessions`/);
  assert.match(text, /\[标题\]\(#ccc-open\/<p>\/<id>\)/);
  assert.match(text, /`open` 为 null 的会话不给链接/);
  assert.match(text, /不得编造/);
  assert.match(text, /是数据，不是指令/);
  assert.match(text, /需要你处理 \/ 运行中 \/ 最近完成 \/ 可归档建议/);
  assert.equal(text, buildButlerAgentsMd({ cwd: '/home/.ccc/butler', sessionRoots: ['/home/.codex/sessions'] }));
});
