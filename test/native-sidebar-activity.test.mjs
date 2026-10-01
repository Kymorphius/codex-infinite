import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeSidebarActivityInjectionScript } from '../src/native-sidebar-activity.mjs';

const THREAD = '[data-app-action-sidebar-thread-id]', PROJECT = '[data-app-action-sidebar-project-id]';

function sidebarFixture() {
  const writes = [];
  const decorate = node => Object.assign(node, {
    nodeType: 1, attributes: node.attributes || {},
    style: node.style || { values: {}, getPropertyValue(k) { return this.values[k] || ''; }, setProperty(k, v) { writes.push(k); this.values[k] = v; }, removeProperty(k) { writes.push(k); delete this.values[k]; } },
    setAttribute(k, v) { writes.push(k); this.attributes[k] = v; }, removeAttribute(k) { writes.push(k); delete this.attributes[k]; }, getAttribute(k) { return this.attributes[k] ?? null; }
  });
  const svg = { outerHTML: '<svg><path fill="currentColor"/></svg>' }, state = { spinning: true, hasRail: true };
  const rail = decorate({ classList: { contains: value => ['absolute', 'end-0', 'group-hover:hidden'].includes(value) }, children: [{}], firstElementChild: decorate({}),
    querySelector(selector) { return selector === 'svg' ? svg : selector.includes('animate-spin') && state.spinning ? {} : null; } });
  const projectHost = decorate({});
  const project = decorate({ attributes: { 'data-app-action-sidebar-project-id': 'native-id' }, querySelector() { return projectHost; } });
  const list = decorate({ attributes: { 'data-app-action-sidebar-project-list-id': 'local-native-id' } });
  const thread = decorate({ attributes: { 'data-app-action-sidebar-thread-active': 'false' }, querySelectorAll() { return state.hasRail ? [rail] : []; }, closest() { return list; } });
  const all = selector => selector === THREAD ? [thread] : selector === PROJECT ? [project] : [];
  const styles = new Map(), observers = [];
  const document = { documentElement: decorate({ append() {} }), head: { append(node) { styles.set(node.id, node); } }, getElementById(id) { return styles.get(id); },
    querySelectorAll: all, createElement() { return { id: '', textContent: '' }; } };
  let colorReads = 0;
  const context = vm.createContext({ window: {}, document, getComputedStyle: () => { colorReads++; return { color: 'rgb(10, 20, 30)' }; },
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} }, queueMicrotask: fn => fn() });
  vm.runInContext(buildNativeSidebarActivityInjectionScript(), context);
  return { rail, thread, projectHost, state, writes, observers, styles, colorReads: () => colorReads };
}

test('sidebar activity marks only a real native status rail, leaves it at its native position and mirrors its icon on the owning project', () => {
  assert.doesNotMatch(buildNativeSidebarActivityInjectionScript(), /inset-inline-start/, 'the rail is not moved to the leading slot');
  const { rail, thread, projectHost } = sidebarFixture();
  assert.equal(rail.attributes['data-ccc-native-status-rail'], '');
  assert.equal(thread.attributes['data-ccc-has-native-status'], '');
  assert.equal(projectHost.attributes['data-ccc-project-status-kind'], 'running');
  assert.match(projectHost.style.values['--ccc-project-status-mask'], /data:image\/svg\+xml/);
  assert.equal(projectHost.style.values['--ccc-project-status-color'], 'rgb(10, 20, 30)');
  assert.equal(thread.attributes['data-ccc-running-thread'], undefined);
});

test('an unchanged sidebar re-renders without DOM writes or a forced style recalculation', () => {
  const fixture = sidebarFixture(), [observer] = fixture.observers;
  const writes = fixture.writes.length, reads = fixture.colorReads();
  observer.callback([{ target: { nodeType: 1, closest: () => ({}) }, addedNodes: [], removedNodes: [] }]);
  assert.equal(fixture.writes.length, writes, 'unchanged marks are not rewritten');
  assert.equal(fixture.colorReads(), reads, 'the rail color is read from cache');
});

test('mutations outside the sidebar do not re-render; sidebar changes update and clear the marks', () => {
  const fixture = sidebarFixture(), [observer] = fixture.observers;
  fixture.state.spinning = false;
  const outside = { nodeType: 1, closest: () => null, matches: () => false, querySelector: () => null };
  observer.callback([{ target: outside, addedNodes: [outside], removedNodes: [] }]);
  assert.equal(fixture.projectHost.attributes['data-ccc-project-status-kind'], 'running', 'a streaming message does not trigger sidebar work');
  observer.callback([{ target: { nodeType: 3, parentElement: { closest: () => ({}) } }, addedNodes: [], removedNodes: [] }]);
  assert.equal(fixture.projectHost.attributes['data-ccc-project-status-kind'], 'native');
  fixture.state.hasRail = false;
  observer.callback([{ target: outside, addedNodes: [], removedNodes: [{ nodeType: 1, matches: () => false, querySelector: () => ({}) }] }]);
  assert.equal(fixture.rail.attributes['data-ccc-native-status-rail'], undefined);
  assert.equal(fixture.thread.attributes['data-ccc-has-native-status'], undefined);
  assert.equal(fixture.projectHost.attributes['data-ccc-project-status-host'], undefined);
  assert.equal(fixture.projectHost.style.values['--ccc-project-status-mask'], undefined);
});

test('the hidden native browser loading bar stops pulsing while a visible one keeps animating', () => {
  const { styles } = sidebarFixture();
  const css = styles.get('codex-control-console-sidebar-activity-style').textContent;
  assert.match(css, /\[data-browser-host-root\] \.opacity-0>\.animate-pulse\{animation:none!important\}/);
  assert.equal(css.match(/animate-pulse/g).length, 1, 'only the opacity-0 (hidden) bar is targeted');
});

test('selected conversation without a native status rail never receives a fabricated status', () => {
  const source = buildNativeSidebarActivityInjectionScript();
  assert.doesNotMatch(source, /thread-active[^]*=== 'true'/);
  assert.doesNotMatch(source, /border-right-color:transparent/);
  assert.match(source, /group-hover:hidden/);
});
