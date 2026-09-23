import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildNativeComposerHeldQueueInjectionScript } from '../../src/native-composer-held-queue.mjs';

// Minimal event/DOM adapter; tests execute the complete production injection,
// not extracted source fragments. Native RPCs stay in this in-memory fixture.
class Node {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.events = {}; this.nodeType = 1; }
  get textContent() { return this.text || this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this.text = value; this.children = []; }
  append(...nodes) { for (const node of nodes) { if (typeof node === 'string') continue; node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { this.append(node); this.children.unshift(this.children.pop()); }
  insertBefore(node, before) { this.append(node); if (before) { this.children.pop(); this.children.splice(this.children.indexOf(before), 0, node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  replaceChildren(...nodes) { this.replacements = (this.replacements || 0) + 1; for (const child of this.children) child.parentElement = null; this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return key.startsWith('data-') ? this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? this.attrs[key] ?? null : this.attrs[key] ?? null; }
  matches(selector) { return selector.split(',').some(part => {
    const tag = part.match(/^\w+/)?.[0];
    return (!tag || this.tagName === tag) && [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => value === undefined ? this.getAttribute(key) !== null : this.getAttribute(key) === value);
  }); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  addEventListener(name, listener) { (this.events[name] ||= new Set()).add(listener); }
  removeEventListener(name, listener) { this.events[name]?.delete(listener); }
  dispatchEvent(event) { for (const listener of this.events[event.type] || []) listener(event); }
  click() { if (!this.disabled) this.dispatchEvent({ type: 'click', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); }
  focus() {}
}

export function heldRuntimeHarness(ids) {
  const document = new Node('document'), html = new Node('html'), head = new Node('head'), body = new Node('body');
  document.append(html); html.append(head, body); Object.assign(document, { head, body, documentElement: html, createElement: tag => new Node(tag) });
  const markers = ids.map(id => { const node = new Node('div'); node.setAttribute('data-above-composer-conversation-id', id); body.append(node); return node; });
  const root = new Node('section'), editor = new Node('div'), host = new Node('div'), permission = new Node('button');
  root.setAttribute('data-composer-surface-variant', 'default'); editor.setAttribute('data-codex-composer', 'true'); editor.setAttribute('contenteditable', 'true'); permission.setAttribute('data-composer-navigation-target', 'permissions');
  body.append(root); root.append(editor, host); host.append(permission);
  const window = new Node('window'), stored = new Map(), timers = new Map(), intervals = new Map(), requests = [], claims = [], completions = [];
  let counter = 0;
  const schedule = (fn, delay) => { const id = ++counter; timers.set(id, { fn, delay }); return id; };
  window.__cccProjectChecklist = { openClaimableForCurrentThread: id => claims.push(id), completeAssignedTask: (...args) => { completions.push(args); return true; } };
  window.electronBridge = { sendMessageFromView: message => requests.push(message.request) };
  const context = vm.createContext({ document, window, HTMLElement: Node, crypto: webcrypto, queueMicrotask, Event,
    localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    setTimeout: schedule, clearTimeout: id => timers.delete(id), setInterval: (fn, delay) => { const id = ++counter; intervals.set(id, { fn, delay }); return id; }, clearInterval: id => intervals.delete(id),
    MutationObserver: class { constructor(callback) { this.callback = callback; } observe(node, options) { this.options = options; } disconnect() {} }
  });
  vm.runInContext(buildNativeComposerHeldQueueInjectionScript(), context);
  const flushInstall = () => { for (const [id, timer] of [...timers]) if (timer.delay <= 50) { timers.delete(id); timer.fn(); } };
  flushInstall();
  return { document, window, markers, requests, claims, completions, flushInstall,
    reinject: () => { vm.runInContext(buildNativeComposerHeldQueueInjectionScript(), context); flushInstall(); },
    find: selector => document.querySelector(selector),
    texts: () => document.querySelectorAll('[data-ccc-held-text]').map(node => node.textContent),
    publish: value => window.__codexControlConsoleSetAssignedChecklistTasks(value),
    notify: () => window.__codexControlConsoleHeldQueueObserver.callback([{ addedNodes: [] }]),
    navigate: id => { markers.at(-1).setAttribute('data-above-composer-conversation-id', id || ''); },
    respond: (request, result) => window.dispatchEvent({ type: 'message', data: { type: 'mcp-response', hostId: 'local', message: { id: request.id, result } } })
  };
}
