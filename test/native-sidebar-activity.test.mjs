import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeSidebarActivityInjectionScript } from '../src/native-sidebar-activity.mjs';

test('sidebar activity moves only a real native status rail and mirrors its icon on the owning project', () => {
  const decorate = node => Object.assign(node, {
    attributes: node.attributes || {}, style: node.style || { values: {}, setProperty(k, v) { this.values[k] = v; }, removeProperty(k) { delete this.values[k]; } },
    setAttribute(k, v) { this.attributes[k] = v; }, removeAttribute(k) { delete this.attributes[k]; }, getAttribute(k) { return this.attributes[k] ?? null; }
  });
  const svg = { outerHTML: '<svg><path fill="currentColor"/></svg>' }, spinner = {};
  const rail = decorate({ classList: { contains: value => ['absolute', 'end-0', 'group-hover:hidden'].includes(value) }, children: [{}], firstElementChild: {},
    querySelector(selector) { return selector === 'svg' ? svg : selector.includes('animate-spin') ? spinner : null; } });
  const projectHost = decorate({});
  const project = decorate({ attributes: { 'data-app-action-sidebar-project-id': 'native-id' }, querySelector() { return projectHost; } });
  const list = decorate({ attributes: { 'data-app-action-sidebar-project-list-id': 'local-native-id' } });
  const thread = decorate({ attributes: { 'data-app-action-sidebar-thread-active': 'false' }, querySelectorAll() { return [rail]; }, closest() { return list; } });
  const all = selector => selector === '[data-app-action-sidebar-thread-id]' ? [thread] : selector === '[data-app-action-sidebar-project-id]' ? [project] : [];
  const styles = new Map();
  const document = { documentElement: { append() {} }, head: { append(node) { styles.set(node.id, node); } }, getElementById(id) { return styles.get(id); },
    querySelectorAll: all, createElement() { return { id: '', textContent: '' }; } };
  const context = vm.createContext({ window: {}, document, getComputedStyle: () => ({ color: 'rgb(10, 20, 30)' }), MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask: fn => fn() });
  vm.runInContext(buildNativeSidebarActivityInjectionScript(), context);
  assert.equal(rail.attributes['data-ccc-native-status-rail'], '');
  assert.equal(thread.attributes['data-ccc-has-native-status'], '');
  assert.equal(projectHost.attributes['data-ccc-project-status-kind'], 'running');
  assert.match(projectHost.style.values['--ccc-project-status-mask'], /data:image\/svg\+xml/);
  assert.equal(projectHost.style.values['--ccc-project-status-color'], 'rgb(10, 20, 30)');
  assert.equal(thread.attributes['data-ccc-running-thread'], undefined);
});

test('selected conversation without a native status rail never receives a fabricated status', () => {
  const source = buildNativeSidebarActivityInjectionScript();
  assert.doesNotMatch(source, /thread-active[^]*=== 'true'/);
  assert.doesNotMatch(source, /border-right-color:transparent/);
  assert.match(source, /group-hover:hidden/);
});
