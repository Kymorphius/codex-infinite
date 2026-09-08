import test from 'node:test';
import assert from 'node:assert/strict';
import { findNativeNewTaskAction, readNativeNewTaskScope, buildNativeNewTaskAdapterScript } from '../src/native-new-task-adapter.mjs';
test('only the complete native start action is selected, ambiguity fails closed', () => {
  function start(scope, options) { return { focusComposerNonce: 1, prefillAeonStartTarget: options, activeProject: scope, prefillChatGptSystemHints: [] }; }
  assert.equal(findNativeNewTaskAction({ start, unrelated() {}, atom: {} }), start);
  assert.equal(findNativeNewTaskAction({ first: start, second: start }), null);
  assert.equal(findNativeNewTaskAction({ route() { return { focusComposerNonce: 1 }; } }), null);
  assert.doesNotThrow(() => new Function(buildNativeNewTaskAdapterScript()));
});
test('scope comes only from exact native new-task component, not project or context maps', () => {
  const scope = { get() {}, set() {}, query: {}, scope: {}, node: {} };
  function Native() { return { startNewConversation: true, startNewConversationInProject: true }; }
  const fiber = { type: Native, memoizedProps: { homeComposerMode: 'chat' }, updateQueue: { memoCache: { data: [[Native, new Map(), scope, scope]] } } };
  const button = { textContent: '新聊天', getAttribute: () => null, __reactFiberTest: fiber };
  const document = { querySelectorAll: () => [button] };
  assert.equal(readNativeNewTaskScope(document), scope);
  fiber.updateQueue.memoCache.data[0].push({ ...scope }); assert.equal(readNativeNewTaskScope(document), null);
  button.textContent = '在项目中开始新聊天'; assert.equal(readNativeNewTaskScope(document), null);
});
