import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeRemoteProjectCopyUiSource } from '../src/native-remote-project-copy-ui.mjs';

function harness({ clipboardFails = false, fallback = true, unifiedSidebar = { enabled: false } } = {}) {
  const nodes = [], writes = [];
  function element(tag, textContent) {
    const node = { tag, textContent, style: {}, children: [], handlers: {},
      setAttribute(name, value) { this[name] = value; },
      append(...children) { this.children.push(...children); },
      addEventListener(name, handler) { this.handlers[name] = handler; },
      remove() { this.removed = true; }, select() {}, focus() { this.focused = true; },
      getBoundingClientRect() { return { width: 200, height: 90 }; }
    };
    nodes.push(node); return node;
  }
  const context = vm.createContext({ element, unifiedSidebar, window: {}, innerWidth: 800, innerHeight: 600,
    navigator: { clipboard: { async writeText(value) { if (clipboardFails) throw Error('denied'); writes.push(value); } } },
    document: { body: { append() {} }, addEventListener() {}, removeEventListener() {},
      execCommand(command) { assert.equal(command, 'copy'); if (fallback === 'throw') throw Error('denied'); return fallback; } },
    setTimeout() {}, queueMicrotask(fn) { fn(); }
  });
  vm.runInContext(buildNativeRemoteProjectCopyUiSource(), context);
  function open(sourceDirectory, status = 'connected', extra = {}) {
    context.openProjectMenu({ preventDefault() {}, stopPropagation() {}, clientX: 50, clientY: 50 },
      { id: 'device', status }, { name: 'project', sourceDirectory, ...extra });
    return nodes.findLast(node => node.role === 'menu');
  }
  return { context, nodes, writes, open };
}

for (const path of ['/Users/matrix/项目 name', 'D:\\333.开发\\项目 name']) {
  test(`project menu copies exact path while offline: ${path}`, async () => {
    const h = harness(), menu = h.open(path, 'offline');
    const [copyPath, transfer] = menu.children;
    assert.equal(copyPath.textContent, '复制项目路径');
    assert.equal(copyPath.disabled, false);
    assert.equal(copyPath.focused, true);
    assert.equal(transfer.disabled, true);
    assert.equal(await copyPath.handlers.click(), true);
    assert.deepEqual(h.writes, [path]);
    assert.equal(menu.removed, true);
    assert.equal(h.nodes.at(-1).textContent, '项目路径已复制');
  });
}

test('missing or ambiguous source directory disables copying', () => {
  for (const path of [null, undefined, '', '   ']) {
    const h = harness(), [copyPath] = h.open(path).children;
    assert.equal(copyPath.disabled, true);
    assert.equal(copyPath.handlers.click, undefined);
    assert.match(copyPath.title, /不可用/);
    assert.deepEqual(h.writes, []);
  }
});

for (const fallback of [true, false, 'throw']) {
  test(`clipboard fallback cleans up and reports result: ${fallback}`, async () => {
    const h = harness({ clipboardFails: true, fallback }), menu = h.open('/project');
    assert.equal(await menu.children[0].handlers.click(), fallback === true);
    const input = h.nodes.find(node => node.tag === 'textarea');
    assert.equal(input.textContent, '/project');
    assert.equal(input.removed, true);
    assert.equal(Boolean(menu.removed), fallback === true);
    assert.equal(h.nodes.at(-1).textContent, fallback === true ? '项目路径已复制' : '复制失败，请重试');
  });
}

test('conversation ID clipboard behavior is preserved', async () => {
  const h = harness();
  assert.equal(await h.context.copyRemoteThreadId(' thread-id '), true);
  assert.deepEqual(h.writes, ['thread-id']);
  assert.equal(h.nodes.at(-1).textContent, '会话 ID 已复制');
});


test('remote multi-root menu copies all paths without enabling project transfer', async () => {
  const h = harness(), menu = h.open(null, 'connected', { sourceDirectories: ['D:\\一', '/two'] });
  assert.equal(await menu.children[0].handlers.click(), true);
  assert.deepEqual(h.writes, ['D:\\一\n/two']);
  assert.equal(menu.children.at(-1).disabled, true);
  const one = harness(), choices = one.open(null, 'offline', { sourceDirectories: ['/one', '/two'] });
  await choices.children[2].handlers.click(); assert.deepEqual(one.writes, ['/two']);
});

test('remote project without a path still offers its project key', async () => {
  const h = harness(), menu = h.open(null, 'offline', { key: 'project:remote-id' });
  assert.equal(menu.children[0].textContent, '复制项目 ID');
  await menu.children[0].handlers.click(); assert.deepEqual(h.writes, ['project:remote-id']);
});


test('unified menu assigns an offline remote project without changing its owner or copying it', () => {
  const moves = [];
  const h = harness({ unifiedSidebar: { enabled: true, destinations: () => [{ key: '等待', label: '等待' }], destination: () => 'Projects', assign: (...args) => moves.push(args) } });
  const menu = h.open('/remote/path', 'offline', { key: 'remote-project' });
  const move = menu.children.find(node => node.textContent === '移入 等待');
  assert.ok(move); move.handlers.click();
  assert.equal(moves[0][0].id, 'device');
  assert.equal(moves[0][1].key, 'remote-project');
  assert.equal(moves[0][2], '等待');
  assert.deepEqual(h.writes, []);
});
