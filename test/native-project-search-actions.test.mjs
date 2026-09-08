import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installNativeProjectSearchActions } from '../src/native-project-search-actions.mjs';

function harness(rows = []) {
  const messages = [], notices = [];
  const context = vm.createContext({ window: { postMessage(value) { messages.push(value); } },
    document: { querySelectorAll() { return rows; }, body: { append(node) { notices.push(node.textContent); } },
      createElement() { return { style: {}, setAttribute() {}, remove() {} }; } }, setTimeout(fn) { fn(); } });
  vm.runInContext(`(${installNativeProjectSearchActions.toString()})()`, context);
  return { window: context.window, actions: context.window.__cccProjectSearchActions, messages, notices };
}
test('unmounted project uses full native initialization and never a raw route', async () => {
  const h = harness();
  assert.equal(await h.actions.create({ id: 'server', checklistKey: 'native' }), false);
  assert.equal(h.messages.length, 0);
});
test('mounted project invokes its exact native new-chat button', async () => {
  let clicked = 0;
  const h = harness([{ getAttribute: () => 'native', querySelectorAll: () => [{ getAttribute: () => '在项目中开始新聊天', click() { clicked++; } }] }]);
  await h.actions.create({ id: 'server', checklistKey: 'native' });
  assert.equal(clicked, 1); assert.equal(h.messages.length, 0);
});
test('remote projects and unlisted paths never dispatch local actions', async () => {
  const h = harness(), remote = { id: 'p', device: { kind: 'remote-codex' }, sourceDirectories: ['D:\\Project'] };
  assert.equal(await h.actions.create(remote), false);
  assert.equal(h.actions.openInProject(remote), false);
  assert.equal(await h.actions.openFolder(remote, 'D:\\Project'), false);
  assert.equal(await h.actions.openFolder({ id: 'local', sourceDirectories: ['/project'] }, '/elsewhere'), false);
  assert.equal(h.messages.length, 0); assert.equal(h.notices.length, 4);
});
test('open in project expands, centers and opens the indexed first conversation', () => {
  let expanded = 0, opened = 0, projectCentered = 0, threadCentered = 0;
  const project = { getAttribute(key) { return key === 'data-app-action-sidebar-project-id' ? 'native' : 'true'; },
    click() { expanded++; }, scrollIntoView() { projectCentered++; }, querySelectorAll() { return []; } };
  const thread = { getAttribute() { return 'local:11111111-1111-1111-1111-111111111111'; }, click() { opened++; }, scrollIntoView() { threadCentered++; } };
  const h = harness([project, thread]);
  assert.equal(h.actions.openInProject({ id: 'server', key: 'native', tasks: [{ id: '11111111-1111-1111-1111-111111111111' }] }), true);
  assert.equal(expanded, 1); assert.equal(opened, 1);
  assert.equal(projectCentered, 1); assert.equal(threadCentered, 1);
});

test('full native draft action receives exact mapped project without mode override', async () => {
  const h = harness(), calls = [];
  h.window.__cccNativeNewTask = { async start(id) { calls.push(id); return true; } };
  assert.equal(await h.actions.create({ id: 'server', checklistKey: 'native' }), true);
  assert.deepEqual(calls, ['native']); assert.equal(h.messages.length, 0);
});
