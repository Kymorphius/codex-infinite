import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeProjectPathMenuScript } from '../src/native-project-path-menu.mjs';
import { buildProjectSearchCatalog } from '../src/project-search.mjs';

const ACTION = 'codex-control-console-copy-project-path';
const nativeItems = [{ id: 'edit-project' }, { id: 'remove-project' }];
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ selection = ACTION, roots = ['/project'], clipboardFails = false, fallback = true } = {}) {
  const calls = [], writes = [], nodes = [], listeners = new Map();
  const bridge = { async showContextMenu(items) { calls.push(items); return { id: selection }; } };
  const original = bridge.showContextMenu; Object.freeze(bridge);
  let selected = 0, prepared = 0;
  const items = [{ id: 'edit-project', message: { defaultMessage: '编辑' }, onSelect() { selected++; } }, { id: 'remove-project' }];
  const context = vm.createContext({ window: { electronBridge: bridge },
    navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw Error('denied'); writes.push(value); } } },
    document: { addEventListener(name, callback) { listeners.set(name, callback); }, removeEventListener(name) { listeners.delete(name); },
      body: { append() {} }, execCommand() { if (fallback === 'throw') throw Error('denied'); return fallback; },
      createElement(tag) { const node = { tag, style: {}, setAttribute() {}, select() {}, remove() { this.removed = true; } }; nodes.push(node); return node; } }, setTimeout() {} });
  vm.runInContext(buildNativeProjectPathMenuScript([{ id: 'p', sourceDirectory: roots[0] }]), context);
  function capture(kind = 'data-app-action-sidebar-project-id', projectId = 'p') {
    const row = { getAttribute(key) { return key === kind ? projectId : null; }, hasAttribute(key) { return key === kind; },
      __reactFiberTest: { memoizedProps: { group: { projectId: 'p', projectKind: 'local', rootPaths: roots }, getItems: () => items, onBeforeOpen: () => { prepared++; } }, dependencies: { firstContext: { memoizedValue: { formatMessage: message => message.defaultMessage } } } } };
    const event = { target: { closest: () => row }, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    listeners.get('contextmenu')(event); return event;
  }
  return { bridge, original, calls, writes, nodes, context, capture, listeners, items, selected: () => selected, prepared: () => prepared };
}
for (const path of ['/Users/matrix/项目 name', 'D:\\333.开发\\项目 name']) {
  test(`native project context menu augments existing items and copies exact root: ${path}`, async () => {
    const h = harness({ roots: [path] });
    const event = h.capture(); assert.equal(event.prevented, true);
    await flush();
    assert.equal(h.calls[0][0].label, '复制项目路径');
    assert.equal(h.calls[0][0].enabled, true);
    assert.equal(h.calls[0][2].id, 'edit-project'); assert.equal(h.calls[0][2].label, '编辑');
    assert.equal(h.prepared(), 1); assert.equal(h.bridge.showContextMenu, h.original);
    assert.deepEqual(h.writes, [path]);
    assert.equal(h.nodes.at(-1).textContent, '项目路径已复制');
  });
}
test('native selection invokes its original callback and unrelated menus are untouched', async () => {
  const h = harness({ selection: 'edit-project' }); h.capture(); await flush();
  assert.equal(h.selected(), 1); assert.deepEqual(h.writes, []);
  const items = [{ id: 'thread-rename' }]; await h.bridge.showContextMenu(items);
  assert.equal(h.calls.at(-1), items);
  const before = h.calls.length;
  h.listeners.get('contextmenu')({ target: { closest: () => null } }); await flush();
  assert.equal(h.calls.length, before);
});
test('missing and mismatched native roots cannot be copied', async () => {
  for (const roots of [[], ['']]) {
    const h = harness({ roots }); h.capture(); await flush();
    assert.equal(h.calls[0][0].label, '复制项目 ID'); assert.equal(h.calls[0][0].enabled, true); assert.deepEqual(h.writes, []);
  }
  const h = harness(); const event = h.capture(undefined, 'different'); await flush();
  assert.equal(event.prevented, undefined); assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
});
for (const kind of ['data-new-project-id', 'data-project-search-id']) {
  test(`${kind} opens a copy-only native menu`, async () => {
    const h = harness(); const event = h.capture(kind);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.equal(h.calls[0].length, 1); assert.equal(h.calls[0][0].id, ACTION);
    assert.deepEqual(h.writes, ['/project']);
  });
}
for (const fallback of [true, false, 'throw']) {
  test(`native selection clipboard fallback cleans up: ${fallback}`, async () => {
    const h = harness({ clipboardFails: true, fallback }); h.capture(); await flush();
    const input = h.nodes.find(node => node.tag === 'textarea');
    assert.equal(input.value, '/project'); assert.equal(input.removed, true);
    assert.equal(h.nodes.at(-1).textContent, fallback === true ? '项目路径已复制' : '复制失败，请重试');
  });
}
test('repeated installation is idempotent and disposal preserves frozen native bridge', () => {
  const h = harness(), installed = h.bridge.showContextMenu;
  vm.runInContext(buildNativeProjectPathMenuScript(), h.context);
  assert.equal(h.bridge.showContextMenu, installed);
  h.context.window.__codexControlConsoleProjectPathMenu.dispose();
  assert.equal(h.bridge.showContextMenu, h.original); assert.equal(h.listeners.size, 0);
});
test('project catalog only exposes a unique explicit project root', () => {
  const ordered = [
    { project: { id: 'a', roots: [{ path: 'D:\\项目' }] } },
    { project: { id: 'b', roots: [{ path: '/one' }, { path: '/two' }] } },
    { project: { id: 'c', cwd: '/not-a-root' } }
  ];
  assert.deepEqual(buildProjectSearchCatalog(ordered, [], () => null).map(project => project.sourceDirectory), ['D:\\项目', null, null]);
});

test('translated submenus preserve selected callbacks and disabled actions stay inert', async () => {
  const h = harness({ selection: 'nested' }); let nested = 0;
  h.items.push({ id: 'section', message: { defaultMessage: '分组' }, submenu: [{ id: 'nested', message: { defaultMessage: '固定' }, onSelect: () => { nested++; } }] });
  h.capture(); await flush();
  assert.equal(h.calls[0].at(-1).submenu[0].label, '固定'); assert.equal(nested, 1);
  h.items.at(-1).enabled = false;
  h.capture(); await flush(); assert.equal(nested, 1);
});

test('disposal cancels menu selection that has not resolved', async () => {
  const h = harness({ selection: 'edit-project' }); let finish;
  h.items.push({ id: 'unused' });
  // Hold menu preparation so disposal occurs before a menu can be shown.
  const row = { getAttribute: () => 'p', hasAttribute: () => true,
    __reactFiberTest: { memoizedProps: { group: { projectId: 'p', projectKind: 'local', rootPaths: ['/project'] }, getItems: () => nativeItems,
      onBeforeOpen: () => new Promise(resolve => { finish = resolve; }) },
      dependencies: { firstContext: { memoizedValue: { formatMessage: message => message.defaultMessage } } } } };
  h.listeners.get('contextmenu')({ target: { closest: () => row }, preventDefault() {}, stopPropagation() {} });
  h.context.window.__codexControlConsoleProjectPathMenu.dispose(); finish(); await flush();
  assert.equal(h.calls.length, 0); assert.deepEqual(h.writes, []);
});

test('multi-root native projects copy all paths in order or a selected individual path', async () => {
  const roots = ['D:\\一', '/two', 'D:\\一'];
  const all = harness({ roots }); all.capture(); await flush();
  assert.deepEqual(all.writes, ['D:\\一\n/two']);
  assert.equal(all.calls[0][0].enabled, true);
  assert.deepEqual(Array.from(all.calls[0][1].submenu, item => item.label), ['D:\\一', '/two']);
  const one = harness({ roots, selection: ACTION + ':1' }); one.capture(); await flush();
  assert.deepEqual(one.writes, ['/two']);
});

test('cloud projects copy their real project link without changing existing actions', async () => {
  const h = harness({ selection: ACTION + '-link' });
  const id = 'g-p-abc123';
  const row = { getAttribute: () => id, hasAttribute: () => true, __reactFiberTest: {
    memoizedProps: { project: { gizmo: { id, short_url: id + '-example' } }, getItems: () => [{ id: 'edit-project' }, { id: 'delete-chatgpt-project' }] },
    dependencies: { firstContext: { memoizedValue: { formatMessage: message => message.defaultMessage } } }
  } };
  h.listeners.get('contextmenu')({ target: { closest: () => row }, preventDefault() {}, stopPropagation() {} }); await flush();
  assert.equal(h.calls[0][0].label, '复制项目链接');
  assert.equal(h.calls[0][1].label, '复制项目 ID');
  assert.deepEqual(h.writes, ['https://chatgpt.com/g/g-p-abc123-example/project']);
});


test('search-key clipboard catalog isolates equal project IDs on different devices', async () => {
  const h = harness();
  h.context.window.__codexControlConsoleProjectPathMenu.set([
    { id: 'same', searchKey: 'local-key', sourceDirectories: ['/local'] },
    { id: 'same', searchKey: 'remote-key', sourceDirectories: ['D:\\Remote'] }
  ]);
  h.capture('data-project-search-id', 'remote-key'); await flush();
  assert.deepEqual(h.writes, ['D:\\Remote']);
});

test('search result menu explicitly locates the local project and opens its first conversation', async () => {
  const h = harness({ selection: 'ccc-open-in-project' }), opened = [];
  h.context.window.__cccProjectSearchActions = { openInProject(project) { opened.push(project); } };
  h.context.window.__codexControlConsoleProjectPathMenu.set([{ id: 'server', searchKey: 'local-key', checklistKey: 'native', sourceDirectories: ['/project'], tasks: [{ id: 'first' }] }]);
  h.capture('data-project-search-id', 'local-key'); await flush();
  assert.equal(h.calls[0][0].label, '在项目中打开');
  assert.equal(opened[0].key, 'native'); assert.equal(opened[0].tasks[0].id, 'first');
});

test('project checklist menu opens the stable selected project without native mutation', async () => {
  const h = harness({ selection: 'ccc-project-checklist' }), opened = [];
  h.context.window.__cccProjectChecklist = { open(project) { opened.push(project); } };
  h.capture(); await flush();
  assert.equal(h.calls[0][0].label, '任务清单');
  assert.equal(opened[0].key, 'p'); assert.equal(h.selected(), 0);
  h.capture('data-new-project-id'); await flush();
  assert.equal(opened[1].key, 'p');
});

test('search folder menus select exact roots on Mac and Windows and reject remote dispatch', async () => {
  for (const [platform, label] of [['MacIntel', '在 Finder 中打开'], ['Win32', '在资源管理器中打开']]) {
    const h = harness({ selection: 'ccc-open-project-folder:1' }), opened = [];
    h.context.navigator.platform = platform;
    h.context.window.__cccProjectSearchActions = { openFolder(project, path) { opened.push(path); } };
    h.context.window.__codexControlConsoleProjectPathMenu.set([{ id: 'p', sourceDirectories: ['/one', '/two'] }]);
    h.capture('data-project-search-id'); await flush();
    assert.equal(h.calls[0][0].label, label);
    assert.deepEqual(opened, ['/two']);
    assert.equal(h.calls[0].some(item => item.id === ACTION), true);
  }
  const h = harness({ selection: 'cancel' });
  h.context.window.__cccProjectSearchActions = { openFolder() { throw Error('must not open locally'); } };
  h.context.window.__codexControlConsoleProjectPathMenu.set([{ id: 'p', device: { kind: 'remote-codex', name: 'Windows' }, sourceDirectories: ['D:\\Remote'] }]);
  h.capture('data-project-search-id'); await flush();
  assert.equal(h.calls[0][0].enabled, false);
  assert.match(h.calls[0][0].label, /Windows/);
});

test('search and native menus share native project checklist identity', async () => {
  const h = harness({ selection: 'ccc-project-checklist' }), opened = [];
  h.context.window.__cccProjectChecklist = { open(project) { opened.push(project); } };
  vm.runInContext(buildNativeProjectPathMenuScript([{ id: 'server', searchKey: '["local","server"]', checklistKey: 'p', name: '项目' }]), h.context);
  h.capture('data-project-search-id', '["local","server"]'); await flush();
  assert.equal(opened[0].key, 'p');
});
