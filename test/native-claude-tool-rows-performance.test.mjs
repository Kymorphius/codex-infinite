import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeClaudeToolRowsInjectionScript } from '../src/native-claude-tool-rows.mjs';

function fixture({ shared = true } = {}) {
  const counts = { cssWrites: 0, cssAppends: 0, timelineScans: 0 }, observers = new Set(), microtasks = [];
  const matches = (node, selector) => selector.split(',').some(part => {
    const attr = /^\[([^\]]+)\]$/.exec(part.trim());
    if (attr) return node.hasAttribute(attr[1]);
    if (part === '.sr-only') return node.className === 'sr-only';
    return node.tag === part;
  });
  class Node {
    constructor(tag = 'div', text = '') { this.tag = tag; this.nodeType = 1; this.attrs = {}; this.dataset = {}; this.children = []; this.text = text;
      this.style = { getPropertyValue(name) { return this[name] || ''; }, setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } }; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { if (this.tag === 'style') counts.cssWrites++; this.text = value; this.children = []; }
    get childNodes() { return this.children; }
    get isConnected() { return this === html || Boolean(this.parentElement?.isConnected); }
    get previousElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) - 1] || null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    removeAttribute(name) { delete this.attrs[name]; }
    matches(selector) { return matches(this, selector); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    append(...nodes) { for (const node of nodes) { if (node.tag === 'style' && this.tag === 'head') counts.cssAppends++; node.remove(); this.children.push(node); node.parentElement = this; } }
    before(node) { node.remove(); const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 0, node); node.parentElement = this.parentElement; }
    remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    querySelectorAll(selector) {
      if (selector === 'p,div,span' && this.hasAttribute('data-thread-user-message-navigation-content')) counts.timelineScans++;
      const walk = node => node.children.flatMap(child => [child, ...walk(child)]);
      return walk(this).filter(node => selector === 'style[data-ccc-claude-tool-style]' ? node.tag === 'style' && node.hasAttribute('data-ccc-claude-tool-style')
        : selector === '[data-ccc-claude-tool-label]' ? Object.hasOwn(node.dataset, 'cccClaudeToolLabel') : node.matches(selector));
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const html = new Node('html'), head = new Node('head'), body = new Node('body'), sidebar = new Node('nav'); html.append(head, body); body.append(sidebar);
  const makeTimeline = () => { const timeline = new Node(); timeline.setAttribute('data-thread-user-message-navigation-content', '');
    const turn = new Node(); turn.setAttribute('data-turn-key', 'turn-one'); timeline.append(turn); return { timeline, turn }; };
  let { timeline, turn } = makeTimeline(); body.append(timeline);
  const document = { documentElement: html, head, body, querySelector: selector => html.querySelector(selector), createElement: tag => new Node(tag) };
  const window = shared ? { __codexControlConsoleObserver: true } : {};
  const context = vm.createContext({ document, window, getComputedStyle: () => ({ rowGap: '24px' }), queueMicrotask: callback => microtasks.push(callback),
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node, options) { this.options = options; observers.add(this); } disconnect() { observers.delete(this); } } });
  const script = buildNativeClaudeToolRowsInjectionScript(), install = () => vm.runInContext(script, context);
  const flush = () => { while (microtasks.length) microtasks.shift()(); };
  const notify = records => { if (window.__codexControlConsoleObserver) for (const subscriber of window.__codexControlConsoleMutationSubscribers || []) subscriber(records.filter(record => record.type !== 'characterData'));
    for (const observer of observers) { const accepted = records.filter(record => observer.options[record.type]); if (accepted.length) observer.callback(accepted); } flush(); };
  const notice = text => { const node = new Node('p', text); turn.append(node); return node; };
  const rows = () => timeline.querySelectorAll('[data-ccc-claude-tool-row]');
  return { window, counts, observers, install, notify, notice, rows, sidebar, document, body, context,
    get timeline() { return timeline; }, remount(text) { const old = timeline; old.remove(); ({ timeline, turn } = makeTimeline()); body.append(timeline); const source = notice(text);
      notify([{ type: 'childList', target: body, addedNodes: [timeline], removedNodes: [old] }]); return source; } };
}

test('actual first install and repeated same-version installs keep CSS and one subscriber stable', () => {
  const f = fixture(); f.notice('Claude 原生工具：Bash · npm test（执行中）'); f.install();
  assert.deepEqual(f.counts, { cssWrites: 1, cssAppends: 1, timelineScans: 1 });
  for (let index = 0; index < 10; index++) f.install();
  assert.deepEqual(f.counts, { cssWrites: 1, cssAppends: 1, timelineScans: 1 });
  assert.equal(f.window.__codexControlConsoleMutationSubscribers.size, 1); assert.equal(f.observers.size, 1);
  assert.equal(f.rows().length, 1);
});

test('500 unrelated sidebar mutations never scan the timeline or rewrite CSS', () => {
  const f = fixture(); f.install(); const before = { ...f.counts };
  for (let index = 0; index < 500; index++) f.notify([{ type: 'childList', target: f.sidebar, addedNodes: [], removedNodes: [] }]);
  assert.deepEqual(f.counts, before);
});

test('text updates, finish notices and timeline remounts still convert current activity', () => {
  for (const shared of [true, false]) {
    const f = fixture({ shared }), source = f.notice('Claude 原生工具：Bash · npm test'); f.install(); assert.equal(f.rows().length, 0);
    source.textContent += '（执行中）';
    f.notify([{ type: 'characterData', target: { nodeType: 3, parentElement: source }, addedNodes: [], removedNodes: [] }]);
    assert.equal(f.rows().length, 1);
    const done = f.notice('Claude 原生工具：Bash · npm test（已完成 · 退出码 0）');
    f.notify([{ type: 'childList', target: done.parentElement, addedNodes: [done], removedNodes: [] }]);
    assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].querySelector('[data-ccc-claude-tool-label]').textContent, '已运行命令');
    f.remount('Claude 原生工具：Read · file.mjs（已完成）');
    assert.equal(f.rows().length, 1); assert.equal(f.rows()[0].querySelector('[data-ccc-claude-tool-label]').textContent, '已读取文件 file.mjs');
    const scans = f.counts.timelineScans; f.install(); assert.equal(f.counts.timelineScans, scans);
  }
});

test('version upgrades retire subscriptions and adopt existing rows before merging completion', () => {
  const f = fixture(), source = f.notice('Claude 原生工具：Bash · npm test（执行中）'); f.install(); const row = f.rows()[0];
  f.window.__cccClaudeToolRows.version = 'old'; f.install();
  assert.equal(f.rows().length, 1); assert.equal(f.rows()[0], row); assert.equal(f.window.__codexControlConsoleMutationSubscribers.size, 1); assert.equal(f.observers.size, 1);
  source.textContent = 'Claude 原生工具：Bash · npm test（已完成 · 退出码 0）';
  f.notify([{ type: 'characterData', target: { nodeType: 3, parentElement: source }, addedNodes: [], removedNodes: [] }]);
  assert.equal(f.rows().length, 1); assert.equal(row.querySelector('[data-ccc-claude-tool-label]').textContent, '已运行命令');
});

test('stylesheet removal and common observer arrival recover without a full timeline scan', () => {
  const f = fixture({ shared: false }); f.install(); const scans = f.counts.timelineScans;
  f.document.querySelector('style[data-ccc-claude-tool-style]').remove(); f.window.__codexControlConsoleObserver = true; f.install();
  assert.equal(f.counts.cssWrites, 2); assert.equal(f.counts.cssAppends, 2); assert.equal(f.counts.timelineScans, scans);
  assert.equal(f.observers.size, 1); assert.equal([...f.observers][0].options.childList, false);
});

test('legacy recovery removes only the owned compact reference and keeps identical unrelated callbacks', () => {
  const f = fixture();
  vm.runInContext(`window.__cccClaudeToolRows = { render() {}, compact() {} };
    function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }
    window.legacySchedule = schedule;
    window.__codexControlConsoleMutationSubscribers = new Set([schedule, window.__cccClaudeToolRows.compact]);`, f.context);
  const other = vm.runInContext(`(() => {
    function schedule() { if (queued) return; queued = true; queueMicrotask(() => { queued = false; render(); }); }
    return schedule;
  })()`, f.context);
  assert.equal(String(other), String(f.window.legacySchedule));
  const ownedCompact = f.window.__cccClaudeToolRows.compact;
  f.window.__codexControlConsoleMutationSubscribers.add(other); f.install();
  assert.equal(f.window.__codexControlConsoleMutationSubscribers.size, 3);
  assert.equal(f.window.__codexControlConsoleMutationSubscribers.has(other), true);
  assert.equal(f.window.__codexControlConsoleMutationSubscribers.has(f.window.legacySchedule), true);
  assert.equal(f.window.__codexControlConsoleMutationSubscribers.has(ownedCompact), false);
});
