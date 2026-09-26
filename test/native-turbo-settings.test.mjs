import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeTurboUiSource } from '../src/native-turbo-ui.mjs';

class Element {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; this.checked = false; this.disabled = false; this.offsetHeight = 600; this.offsetWidth = 360; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = String(value); this.replaceChildren(); }
  get value() { return this.tagName === 'select' ? (this.children.find(child => child.selected) || this.children[0])?.value || '' : this.currentValue || ''; }
  set value(value) { if (this.tagName === 'select') { for (const child of this.children) child.selected = child.value === value; } else this.currentValue = String(value); }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? this[key] ?? null; }
  matches(selector) { const tag = selector.match(/^\w+/)?.[0]; return (!tag || tag === this.tagName) && [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,key,value]) => value === undefined ? this.getAttribute(key) !== null : this.getAttribute(key) === value); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  addEventListener(type, callback) { (this.events[type] ||= new Set()).add(callback); }
  removeEventListener(type, callback) { this.events[type]?.delete(callback); }
  fire(type, values = {}) { for (const callback of this.events[type] || []) callback({ type, target:this, preventDefault() {}, ...values }); }
  click() { if (!this.disabled) this.fire('click'); }
  getBoundingClientRect() { return { bottom:20, right:360 }; }
}

function runtime(policyChange = {}) {
  const document = new Element('document'), body = new Element('body'); document.append(body);
  document.body = body; document.createElement = tag => new Element(tag);
  const state = { turboActionPending:null, turboActionResult:null }, requests = [];
  const context = vm.createContext({ document, window: { innerHeight:900, innerWidth:1200 }, pending:false, state,
    policy: { enabled:true, active:true, model:'gpt-6-sol', reasoningEffort:'high', fast:true, millionContext:false, autoDisableGlobalRouting:false,
      deviceIds:['local'], efforts:new Map(), modelOptions:[{ id:'gpt-6-sol', efforts:['low','high'] }], devices:[{ id:'local',name:'本机' }, { id:'peer',name:'远端' }], ...policyChange },
    setTimeout: fn => fn(), turboSend(action, operation = 'sync') { if (context.pending) return; requests.push({ action:JSON.parse(JSON.stringify(action)), operation }); context.pending = true; state.turboActionPending = { requestId:String(requests.length),operation }; state.turboActionResult = null; }
  });
  vm.runInContext(`${buildNativeTurboUiSource()}\nglobalThis.ui = {openSettings,closeSettings,renderTurboSettingsResult};`, context);
  const button = new Element('button'); body.append(button); context.ui.openSettings(button);
  const find = selector => document.querySelector(selector);
  return { context, state, requests, document, find, button, refresh: () => context.ui.renderTurboSettingsResult(),
    submit: () => find('form').fire('submit'), complete(result) { context.pending = false; state.turboActionPending = null; state.turboActionResult = result; context.ui.renderTurboSettingsResult(); } };
}

const panelSelector = '[data-codex-control-console-turbo-popover]';

test('settings save and synchronization are separate operations with unchanged application scope', () => {
  const r = runtime();
  assert.equal(r.find('[data-turbo-operation="save"]').textContent, '保存');
  assert.equal(r.find('[data-turbo-operation="sync"]').textContent, '同步到所有设备');
  assert.match(r.find(panelSelector).textContent, /以上作用范围保持不变/);
  assert.equal(r.find('select[name="reasoningEffort"]').value, 'high');
  r.find('input[name="fast"]').checked = false;
  r.submit();
  assert.equal(r.requests[0].operation, 'save');
  assert.equal(r.requests[0].action.fast, false);
  assert.deepEqual(r.requests[0].action.deviceIds, ['local']);
  assert.ok(r.find(panelSelector));
  r.complete({ operation:'save',nodes:[{ id:'local',name:'本机',status:'applied' }] });
  assert.match(r.find('[role="status"]').textContent, /已保存到本机/);
  r.find('[data-turbo-operation="sync"]').click();
  assert.equal(r.requests[1].operation, 'sync');
  assert.deepEqual(r.requests[1].action, r.requests[0].action);
});

test('pending disables duplicate actions and retains edited form across refreshes and results', () => {
  const r = runtime();
  const fast = r.find('input[name="fast"]'), model = r.find('select[name="model"]');
  fast.checked = false;
  r.find('[data-turbo-operation="sync"]').click();
  assert.equal(r.find('[data-turbo-operation="save"]').disabled, true);
  assert.equal(r.find('[data-turbo-operation="sync"]').disabled, true);
  assert.equal(fast.disabled, true); assert.equal(model.disabled, true);
  assert.equal(r.find('[data-turbo-device="local"]').disabled, true);
  assert.match(r.find('[role="status"]').textContent, /正在保存并同步到所有设备/);
  r.context.policy = { ...r.context.policy,fast:true,model:null };
  r.refresh(); r.submit(); r.find('[data-turbo-operation="sync"]').click();
  r.context.ui.closeSettings(); r.context.ui.openSettings(r.button);
  assert.equal(r.requests.length, 1);
  assert.equal(r.find('input[name="fast"]'), fast);
  assert.equal(fast.checked, false);
  assert.equal(model.value, 'gpt-6-sol');
  r.complete({ operation:'sync',converged:true,nodes:[{ id:'local',status:'applied' }, { id:'peer',status:'applied' }] });
  assert.equal(r.find('[data-turbo-operation="sync"]').disabled, false);
  assert.equal(fast.disabled, false); assert.equal(model.disabled, false);
  assert.match(r.find('[role="status"]').textContent, /已同步到所有设备/);
  assert.equal(r.find('input[name="fast"]'), fast);
  assert.equal(fast.checked, false);
});

test('partial synchronization shows every device result and allows retry', () => {
  const r = runtime();
  r.find('[data-turbo-operation="sync"]').click();
  r.complete({ operation:'sync',converged:false,nodes:[
    { id:'local',name:'本机',status:'applied' },
    { id:'peer',name:'笔记本',status:'mismatch',message:'推理强度未一致' },
    { id:'offline',name:'工作站',status:'error',message:'设备离线' }
  ] });
  assert.match(r.find('[role="status"]').textContent, /同步未全部完成/);
  const results = r.find('[data-turbo-device-results]').textContent;
  assert.match(results, /本机：已同步/); assert.match(results, /笔记本：设置不一致/);
  assert.match(results, /推理强度未一致/); assert.match(results, /工作站：失败设备离线/);
  r.find('[data-turbo-operation="sync"]').click();
  assert.equal(r.requests.length, 2);
});

test('local save failures remain visible and unselected application scope never submits', () => {
  const r = runtime();
  r.find('[data-turbo-device="local"]').checked = false;
  r.submit();
  assert.equal(r.requests.length, 0);
  assert.match(r.find('[role="status"]').textContent, /请至少选择一台生效设备/);
  r.find('input[name="allDevices"]').checked = true;
  r.submit();
  assert.deepEqual(r.requests[0].action.deviceIds, []);
  r.complete({ operation:'save',error:'无法写入设置' });
  assert.match(r.find('[role="status"]').textContent, /保存失败：无法写入设置/);
  assert.ok(r.find(panelSelector));
  assert.equal(r.find('[data-turbo-operation="save"]').disabled, false);
});

test('an inside pointer event does not remove outside dismissal and pending blocks Escape', () => {
  const r = runtime();
  r.document.fire('pointerdown', { target:r.find('form') });
  assert.ok(r.find(panelSelector));
  r.submit(); r.document.fire('keydown', { key:'Escape' });
  assert.ok(r.find(panelSelector));
  r.complete({ operation:'save',nodes:[{ id:'local',status:'applied' }] });
  r.document.fire('pointerdown', { target:r.document.body });
  assert.equal(r.find(panelSelector), null);
  assert.equal(r.document.events.pointerdown.size, 0);
  assert.equal(r.document.events.keydown.size, 0);
});


test('editing after a successful save marks the form unsaved and preserves unavailable model details', () => {
  const r = runtime({ modelOptions:[] });
  assert.equal(r.find('select[name="model"]').value, 'gpt-6-sol');
  assert.equal(r.find('select[name="reasoningEffort"]').value, 'high');
  r.submit(); r.complete({ operation:'save',nodes:[{ id:'local',status:'applied' }] });
  r.find('input[name="allDevices"]').checked = true;
  r.find('form').fire('change');
  assert.match(r.find('[role="status"]').textContent, /设置已修改，尚未保存/);
  assert.equal(r.find('[data-turbo-device-results]').textContent, '');
  assert.equal(r.find('[data-turbo-device="local"]').disabled, true);
});
