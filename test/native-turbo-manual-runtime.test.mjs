import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeTurboInjectionScript, buildNativeTurboSnapshotScript } from '../src/native-turbo-injection.mjs';
import { buildNativeTurboUiSource } from '../src/native-turbo-ui.mjs';

const a = '01a04445-8d03-7243-a4d3-181180bb626d';
const b = '01a04445-8d03-7243-a4d3-181180bb626e';
const manualKey = 'codex-control-console.turbo-manual-choice.v1';
const leaseKey = 'codex-control-console.turbo-setting-leases.v1';
const policy = { enabled:true, active:true, model:'gpt-6-astra', reasoningEffort:'ultra', fast:true, millionContext:false, modelEfforts:[{ model:'gpt-6-astra',effort:'ultra' }] };
const tick = () => new Promise(resolve => setImmediate(resolve));

function runtime({ frozen = false, manual = [], pauseResume = false, withPicker = false } = {}) {
  const listeners = new Map(), storage = new Map([[manualKey, JSON.stringify(manual.map(threadId => ({ threadId,at:1 })))]]);
  const sent = [], applied = [], responses = [];
  let thread = a, native = { model:'gpt-6-sol',reasoningEffort:'medium',serviceTier:'default' };
  const emit = (type, event) => { for (const callback of [...(listeners.get(type) || [])]) callback(event); };
  const bridge = { sendMessageFromView(message) {
    sent.push(message);
    if (message?.request?.method === 'thread/resume') {
      const respond = () => emit('message', { data:{ type:'mcp-response',hostId:'local',message:{ id:message.request.id,result:{ ...native } } } });
      if (pauseResume) responses.push(respond); else queueMicrotask(respond);
    }
    return Promise.resolve();
  } };
  if (frozen) Object.freeze(bridge);
  const picker = new Element('button'), nativeLabel = new Element('span'), documentListeners = new Map();
  nativeLabel.textContent = 'GPT-6 Sol'; picker.append(nativeLabel); picker.setAttribute('data-selected-reasoning-effort','medium');
  const document = {
    querySelector(selector) { return selector === '[data-above-composer-conversation-id]' ? { getAttribute:() => thread } : withPicker && selector.includes('data-composer-navigation-target="reasoning"') ? picker : null; },
    querySelectorAll(selector) { return selector === '[data-above-composer-conversation-id]' ? [{ getAttribute:() => thread }] : []; },
    createElement:tag => new Element(tag),
    addEventListener(type, fn) { if (!documentListeners.has(type)) documentListeners.set(type,new Set()); documentListeners.get(type).add(fn); },
    removeEventListener(type, fn) { documentListeners.get(type)?.delete(fn); }
  };
  const window = {
    electronBridge:bridge,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    __codexControlConsoleGetContextWindow:() => 512000,
    async __codexControlConsoleApplyThreadSettings(id, changes, options) {
      if (options?.shouldApply && !options.shouldApply()) return { applied:false };
      applied.push({ id,changes }); native = { ...native,...changes }; return { applied:true };
    }
  };
  const localStorage = { getItem:key => storage.get(key) || null, setItem:(key,value) => storage.set(key,value) };
  const context = vm.createContext({ window,document,localStorage,setInterval:() => 1,clearInterval() {},setTimeout,clearTimeout,queueMicrotask });
  const inject = () => vm.runInContext(buildNativeTurboInjectionScript(), context);
  const setPolicy = change => vm.runInContext(buildNativeTurboSnapshotScript({ ...policy,...change }), context);
  inject(); setPolicy();
  const makeManual = (id = a) => {
    storage.set(manualKey, JSON.stringify([{ threadId:id,at:2 }]));
    emit('storage', { key:manualKey,newValue:storage.get(manualKey) });
  };
  const send = (id = a) => {
    const message = { type:'mcp-request',hostId:'local',request:{ id:'send-'+id,method:'turn/start',params:{ threadId:id,model:'gpt-6-luna',effort:'low',input:[] } } };
    return { message, result:window.electronBridge.sendMessageFromView(message) };
  };
  return { window,storage,sent,applied,responses,setPolicy,makeManual,send,emit,inject,context,picker,nativeLabel,
    gesture(event) { for (const fn of documentListeners.get(event.type) || []) fn(event); },
    select(id) { thread = id; setPolicy(); }, cleanup() { window.__codexControlConsoleTurboManualCleanup(); window.__codexControlConsoleTurboTurnCleanup(); } };
}

test('manual sessions bypass native send overrides across policy refreshes and global toggles', async t => {
  const r = runtime({ manual:[a] }); t.after(r.cleanup);
  const first = r.send(); await first.result;
  assert.equal(r.sent.at(-1), first.message);
  r.setPolicy({ enabled:false }); r.setPolicy({ enabled:true,model:'gpt-5.5',millionContext:true });
  const next = r.send(); await next.result;
  assert.equal(r.sent.at(-1), next.message);
  assert.equal(r.sent.filter(message => message.request.method === 'thread/resume').length, 0);
  r.select(b);
  const other = r.send(b); await other.result;
  assert.equal(r.sent.at(-1).request.params.model, 'gpt-6-astra');
  assert.equal(r.sent.at(-1).request.params.effort, 'ultra');
});

test('manual change while a context preparation is pending prevents stale dispatch rewrite', async t => {
  const r = runtime({ pauseResume:true }); t.after(r.cleanup);
  r.setPolicy({ millionContext:true });
  const sending = r.send();
  assert.equal(r.sent.at(-1).request.method, 'thread/resume');
  r.makeManual();
  for (const respond of r.responses.splice(0)) respond();
  await sending.result;
  assert.equal(r.sent.at(-1), sending.message);
  assert.equal(r.storage.has('codex-control-console.turbo-turn-receipts.v1'), false);
});

test('manual frozen-bridge sessions discard old leases and do not restore or certify stale settings', async t => {
  const r = runtime({ frozen:true }); t.after(r.cleanup);
  await tick(); await tick();
  assert.equal(r.applied.length, 1);
  assert.equal(JSON.parse(r.storage.get(leaseKey)).length, 1);
  r.makeManual();
  assert.equal(JSON.parse(r.storage.get(leaseKey)).length, 0);
  r.setPolicy({ enabled:false }); await tick();
  r.setPolicy(); await tick();
  assert.equal(r.applied.length, 1);
  r.emit('message', { data:{ type:'mcp-notification',hostId:'local',method:'turn/started',params:{ threadId:a,turn:{ id:b } } } });
  assert.equal(r.storage.has('codex-control-console.turbo-turn-receipts.v1'), false);
  r.select(b); await tick(); await tick();
  assert.equal(r.applied.length, 2);
  assert.equal(r.applied.at(-1).id, b);
});

test('manual choice during frozen-bridge settings read prevents subsequent automatic apply', async t => {
  const r = runtime({ frozen:true,pauseResume:true }); t.after(r.cleanup);
  assert.equal(r.responses.length, 1);
  r.makeManual();
  r.responses.shift()(); await tick();
  assert.equal(r.applied.length, 0);
  assert.equal(r.window.__codexControlConsoleLastTurboEnforcement, undefined);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = new Map(); this.style = { visibility:'' }; }
  setAttribute(key,value) { this.attrs.set(key,String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  append(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(selector) { return this.children.find(child => child.hasAttribute(selector.slice(1,-1))) || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.tag === selector ? [child] : []),...child.querySelectorAll(selector)]); }
  closest(selector) { return this.hasAttribute(selector.slice(1,-1)) ? this : this.parent?.closest(selector) || null; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = value; }
}

test('trusted effort change hides a live injected overlay and sends the unchanged native choice', async t => {
  const r = runtime({ withPicker:true }); t.after(r.cleanup);
  assert.ok(r.picker.querySelector('[data-codex-control-console-turbo-effective]'));
  r.gesture({ isTrusted:true,type:'keydown',key:'ArrowLeft',target:{ closest:selector => selector === '[data-reasoning-slider]' ? {} : null } });
  r.picker.setAttribute('data-selected-reasoning-effort','low');
  r.emit('message', { data:{ type:'mcp-notification',hostId:'local',method:'thread/settings/updated',params:{ threadId:a,threadSettings:{ model:'gpt-6-sol',effort:'low' } } } });
  assert.equal(r.picker.querySelector('[data-codex-control-console-turbo-effective]'),null);
  assert.equal(r.nativeLabel.style.visibility,'');
  assert.equal(JSON.parse(r.storage.get(manualKey))[0].threadId,a);
  r.setPolicy();
  const sending = r.send(); await sending.result;
  assert.equal(r.sent.at(-1),sending.message);
  assert.equal(r.picker.querySelector('[data-codex-control-console-turbo-effective]'),null);
});

test('manual exception removes the actual overlay and restores native picker contents, style and tooltip', () => {
  const button = new Element('button'), native = new Element('span');
  native.textContent = 'GPT-6 Luna · Low'; native.style.visibility = 'visible'; button.append(native);
  button.setAttribute('style','color:blue'); button.setAttribute('title','native picker');
  let manual = false;
  const context = vm.createContext({ policy:{ ...policy,efforts:new Map() },
    document:{ querySelector:() => button,createElement:tag => new Element(tag) },
    turboIsEnforcedForCurrentThread:() => !manual
  });
  vm.runInContext(buildNativeTurboUiSource() + '\nglobalThis.decorate = decorateReasoningControl;',context);
  context.decorate();
  assert.ok(button.querySelector('[data-codex-control-console-turbo-effective]'));
  assert.equal(native.style.visibility,'hidden');
  manual = true; context.decorate();
  assert.equal(button.querySelector('[data-codex-control-console-turbo-effective]'),null);
  assert.equal(native.style.visibility,'visible');
  assert.equal(button.getAttribute('style'),'color:blue');
  assert.equal(button.title,'native picker');
  assert.equal(button.hasAttribute('data-codex-control-console-turbo-effective-state'),false);
  context.decorate(); assert.equal(native.style.visibility,'visible');
});
