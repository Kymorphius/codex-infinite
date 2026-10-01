import test from 'node:test';
import assert from 'node:assert/strict';
import { installRouterStatus, renderRouterStatus, routerStatusTitle } from '../public/features/runtime/router-status.js';

function fakePill() {
  const label = { textContent: '' };
  return { hidden: true, title: '', dataset: {}, attributes: {}, listeners: {}, label,
    querySelector: () => label, setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, listener) { this.listeners[type] = listener; } };
}
const stopped = { status: 'stopped', reason: 'Router 服务未加载到 launchd', repair: 'bootstrap', service: { state: 'not loaded' }, health: null, lastRepair: null };

test('pill renders each status and only offers repair when one is available', () => {
  const pill = fakePill();
  renderRouterStatus(pill, { status: 'ready', repair: null, health: { version: '0.6.0' }, service: { state: 'running', pid: 7 } });
  assert.equal(pill.hidden, false); assert.equal(pill.dataset.routerState, 'ready'); assert.equal(pill.label.textContent, '运行中');
  assert.equal(pill.attributes['aria-disabled'], 'true'); assert.match(pill.title, /0\.6\.0/); assert.match(pill.title, /pid 7/);
  renderRouterStatus(pill, stopped);
  assert.equal(pill.label.textContent, '已停止'); assert.equal(pill.attributes['aria-disabled'], 'false'); assert.match(pill.title, /点击启动/);
  renderRouterStatus(pill, null);
  assert.equal(pill.dataset.routerState, 'unknown'); assert.equal(pill.title, 'Router 状态读取失败');
  assert.match(routerStatusTitle({ status: 'ready', lastRepair: { at: '2026-10-01T00:00:00Z', trigger: 'auto', action: 'bootstrap', ok: true } }), /最近自动启动/);
});

test('clicking a stopped pill confirms, posts repair and reports the result', async () => {
  const pill = fakePill(), toasts = [], requests = [];
  let confirmed = false;
  const fetchImpl = async (url, init = {}) => {
    requests.push([url, init.method || 'GET', init.body]);
    return { ok: true, json: async () => (url.endsWith('/repair') ? { status: 'ready', repair: null, lastRepair: { ok: true } } : stopped) };
  };
  const controller = installRouterStatus({ pill, showToast: (message) => toasts.push(message), fetchImpl, documentImpl: {}, schedule() {},
    confirmImpl: async (_message, _document, plan) => { assert.equal(plan.action, '启动'); return confirmed; } });
  await controller.refresh();
  await pill.listeners.click();
  assert.equal(requests.filter(([url]) => url.endsWith('/repair')).length, 0);
  confirmed = true; await pill.listeners.click();
  assert.deepEqual(requests.at(-1), ['/api/router/repair', 'POST', '{"confirm":true}']);
  assert.deepEqual(toasts, ['Router 已启动，状态：运行中']); assert.equal(pill.label.textContent, '运行中');
});
