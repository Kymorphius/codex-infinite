import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeSidebarRestartInjectionScript } from '../src/native-sidebar-restart.mjs';

for (const topMenu of [false, true]) test(`Help menu ${topMenu ? 'Windows top bar' : 'sidebar'} confirms restart and survives replacement`, () => {
  const calls = []; let expanded = false, notify, accepted = false;
  const items = [];
  const makeItem = () => ({ setAttribute() {}, addEventListener(_, callback) { this.click = callback; }, remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }, get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; } });
  const makeMenu = () => ({ children: [], itemClass: '', querySelector(selector) { return selector === '[role="menu"]' ? null : { className: this.itemClass }; }, get lastElementChild() { return this.children.at(-1); }, append(button) { button.remove(); this.children.push(button); button.parentElement = this; } });
  let menu = makeMenu();
  const help = { id: topMenu ? 'application-menu-trigger-help-menu' : 'help-menu', getAttribute: key => key === 'aria-expanded' ? String(expanded) : key === 'aria-controls' ? 'help-menu' : null };
  const win = { confirm: () => accepted, hostRestart: payload => calls.push(JSON.parse(payload)) };
  const context = vm.createContext({ window: win, document: {
    documentElement: {}, createElement: tag => { assert.equal(tag, 'button'); const item = makeItem(); items.push(item); return item; },
    getElementById: () => menu, querySelectorAll: selector => {
      assert.match(selector, /帮助菜单/); assert.match(selector, /application-menu-trigger-help-menu/);
      return [{ getAttribute: () => 'false' }, help];
    }
  }, MutationObserver: class { constructor(callback) { notify = callback; } observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  const source = buildNativeSidebarRestartInjectionScript('http://127.0.0.1:47831', 'hostRestart');
  assert.doesNotMatch(source, /iframe|fetch\(|127\.0\.0\.1/);
  vm.runInContext(source, context);
  const [original, item] = items;
  assert.equal(item.parentElement, null);
  expanded = true; notify();
  assert.equal(item.parentElement, menu);
  assert.deepEqual(menu.children, [original, item]);
  notify(); assert.deepEqual(menu.children, [original, item]);
  menu.itemClass = 'native-menu-item'; notify();
  assert.equal(original.className, 'native-menu-item'); assert.equal(item.className, 'native-menu-item');
  assert.equal(original.textContent, '启动原版');
  assert.equal(item.textContent, '重启加强版');
  original.click(); assert.deepEqual(calls, [{ module: 'original' }]);
  item.click(); assert.equal(calls.length, 1);
  accepted = true; item.click();
  assert.deepEqual(calls, [{ module: 'original' }, { module: 'restart', confirm: true }]);
  menu = makeMenu(); notify(); assert.deepEqual(menu.children, [original, item]);
  expanded = false; notify(); assert.equal(item.parentElement, null); assert.equal(original.parentElement, null);
  win.__codexControlConsoleSidebarRestart.dispose();
});

test('missing current host binding does not install legacy controls', () => {
  vm.runInNewContext(buildNativeSidebarRestartInjectionScript('http://127.0.0.1:47831'), { window: {} });
});
