import vm from 'node:vm';
import { buildNativeProjectChecklistScript } from '../src/native-project-checklist.mjs';

// Runs the checklist injection in a minimal fake DOM; `created()` counts elements built so far.
export function harness(saved = '[]', conversationRows = []) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.value = ''; }
    append(...nodes) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this; this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    replaceWith(...nodes) { const index = this.parent?.children.indexOf(this) ?? -1; if (index >= 0) { for (const node of nodes) if (node && typeof node === 'object') node.parent = this.parent; this.parent.children.splice(index, 1, ...nodes); } }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(k, fn) { this.listeners[k] = fn; }
    focus() {} remove() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  let storage = saved, id = 0, created = 0;
  const document = { body: new Node('body'), head: new Node('head'), createElement: tag => { created++; return new Node(tag); }, querySelectorAll: () => conversationRows };
  const context = vm.createContext({ document, window: { addEventListener() {}, removeEventListener() {} }, crypto: { randomUUID: () => 'id-' + ++id }, localStorage: { getItem: () => storage, setItem: (_, v) => { storage = v; } } });
  vm.runInContext(buildNativeProjectChecklistScript(), context);
  return { api: context.window.__cccProjectChecklist, dialog: document.body.children[0], storage: () => storage, created: () => created };
}
