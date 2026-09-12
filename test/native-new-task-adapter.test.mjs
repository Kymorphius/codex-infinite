import test from 'node:test';
import assert from 'node:assert/strict';
import { findNativeNewTaskAction, findNativeNewTaskModuleUrls, readNativeNewTaskScope, buildNativeNewTaskAdapterScript } from '../src/native-new-task-adapter.mjs';

function discover(links, resources = []) {
  return findNativeNewTaskModuleUrls({ baseURI: 'app://-/index.html', querySelectorAll: () => links }, { getEntriesByType: () => resources.map(name => ({ name })) });
}
test('native project drafts remain available after resource timing records disappear', () => {
  const url = 'app://-/assets/app-initial-current.js';
  assert.deepEqual(discover([{ href: url }]), [url]);
  assert.deepEqual(discover([{ href: '/assets/app-initial-current.js' }, { src: url }]), [url]);
  assert.deepEqual(discover([{ href: url }], ['app://-/assets/app-initial-old.js']), [url]);
});
test('module discovery keeps timing fallback and rejects external or altered asset URLs', () => {
  const url = 'app://-/assets/app-initial-legacy.js';
  const invalid = ['https://example.com/assets/app-initial-fake.js', 'app://elsewhere/assets/app-initial-fake.js', 'app://-/assets/app-primary-fake.js', url + '?override=1', url + '#alias', 'app://user@-/assets/app-initial-fake.js', 'http://[invalid'];
  assert.deepEqual(discover(invalid.map(href => ({ href })), [...invalid, url]), [url]);
  assert.deepEqual(discover([], invalid), []);
});
test('multiple current app manifests remain ambiguous instead of choosing arbitrarily', () => {
  const urls = ['app://-/assets/app-initial-first.js', 'app://-/assets/app-initial-second.js'];
  assert.deepEqual(discover(urls.map(href => ({ href }))), urls);
});
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
