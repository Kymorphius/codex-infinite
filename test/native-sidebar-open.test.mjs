import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { openNativeSidebarItem } from '../src/native-sidebar-open.mjs';

function fixture({ key = 'codex:project:p', source = 'codex', exists = true } = {}) {
  const record = { key, id: 'p', source, conversationKeys: [] };
  const snapshot = { projects: [record], conversations: [], sections: [{ id: 'threads', name: 'Projects', kind: 'projects', itemKeys: [key] }] };
  const calls = [];
  const row = { getAttribute: () => 'p', scrollIntoView: () => calls.push('scroll'), click: () => calls.push('open') };
  const model = { scope: null, projectByKey: new Map([[key, {}]]), sections: [{ id: 'threads', native: { collapsed: true, onCollapsedChange: value => calls.push(['expand', value]) } }] };
  const context = { document: { querySelectorAll: () => exists ? [row] : [] }, window: { postMessage: value => calls.push(value) },
    setTimeout: callback => callback(), input: { action: 'open', sectionId: 'threads', itemKey: key },
    layout: JSON.stringify({ sections: snapshot.sections, projects: [{ key, conversationKeys: [] }] }), read: () => model, project: () => snapshot,
    load: async () => { calls.push('load-mutations'); throw Error('原生侧边栏操作尚未就绪'); }, find: () => {} };
  return { context, calls, snapshot, run: () => vm.runInNewContext(`(${openNativeSidebarItem.toString()})(input,read(),project())`, context) };
}

test('opening Codex and ChatGPT projects does not require mutation modules or a write scope', async () => {
  for (const source of ['codex', 'chatgpt']) {
    const f = fixture({ source, key: source + ':project:p' });
    const result = await f.run();
    assert.equal(result.opened, true);
    assert.deepEqual(f.calls, [['expand', false], 'scroll', 'open']);
  }
});

test('opening a local conversation also works without mutation services', async () => {
  const f = fixture({ key: 'codex:thread:local:p' });
  const result = await f.run();
  assert.equal(result.opened, true);
  assert.equal(f.calls[0].path, '/local/p');
  assert.equal(f.calls.includes('load-mutations'), false);
});

test('unknown project identity never opens a native row', async () => {
  const f = fixture(); f.context.input.itemKey = 'unknown';
  await assert.rejects(f.run(), /条目已不存在/);
  assert.deepEqual(f.calls, []);
});

test('missing project entry fails with an actionable reason', async () => {
  const f = fixture({ exists: false });
  await assert.rejects(f.run(), /原生打开入口尚未就绪/);
  assert.equal(f.calls.includes('load-mutations'), false);
});
