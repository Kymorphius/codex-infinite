import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildNativeGeneralChecklistScript } from '../src/native-general-checklist.mjs';
test('general entry is unique, opens inbox, remounts and disposes without touching native rows', () => {
  class Node {
    constructor(text = '') { this.children = []; this.style = {}; this.attrs = {}; this.events = {}; this.textContent = text; this.className = ''; }
    setAttribute(k,v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] || null; }
    append(n) { n.remove(); this.children.push(n); n.parentElement = this; }
    insertBefore(n, before) { n.remove(); const index = before ? this.children.indexOf(before) : -1; this.children.splice(index < 0 ? this.children.length : index, 0, n); n.parentElement = this; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(n => n !== this); this.parentElement = null; }
    addEventListener(k,fn) { this.events[k] = fn; }
    querySelector(selector) { return selector.includes('open-local-project') ? this.children.find(node => node.attrs['data-codex-control-console-open-local-project'] != null) : null; }
    get nextSibling() { const index = this.parentElement?.children.indexOf(this) ?? -1; return index < 0 ? null : this.parentElement.children[index + 1] || null; }
    get previousElementSibling() { const index = this.parentElement?.children.indexOf(this) ?? -1; return index > 0 ? this.parentElement.children[index - 1] : null; }
  }
  let parent, newChat, openProject, callback, opens = 0, disconnected = false;
  const mount = () => { parent = new Node(); newChat = new Node('新对话'); newChat.className = 'native-top-action'; openProject = new Node('打开本地项目'); openProject.className = newChat.className; openProject.setAttribute('data-codex-control-console-open-local-project', ''); parent.append(newChat); parent.append(openProject); };
  mount();
  const document = { createElement: () => new Node(), documentElement: {}, querySelector: selector => selector.includes('open-local-project') ? openProject : null, querySelectorAll: () => [newChat, openProject, ...parent.children.filter(node => node.attrs['data-ccc-general-checklist-entry'] != null)] };
  const context = vm.createContext({ window: { __cccProjectChecklist: { openGeneral() { opens++; } } }, document, requestAnimationFrame: fn => fn(), MutationObserver: class { constructor(fn) { callback = fn; } observe() {} disconnect() { disconnected = true; } } });
  const script = buildNativeGeneralChecklistScript(); vm.runInContext(script, context); vm.runInContext(script, context);
  assert.equal(parent.children.length, 3); const entry = parent.children[2]; entry.events.click(); assert.equal(opens, 1);
  assert.equal(entry.className, newChat.className); assert.equal(entry.previousElementSibling, openProject); assert.equal(entry.attrs['aria-label'], '综合任务清单');
  const old = parent; mount(); callback(); assert.equal(old.children.length, 2); assert.equal(parent.children[2], entry);
  context.window.__cccGeneralChecklist.dispose(); assert.equal(parent.children.length, 2); assert.equal(disconnected, true);
});
