import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeProjectManagementEntry } from '../src/native-project-management-entry.mjs';
import { buildInjectionScript } from '../src/injection.mjs';
import { NativeConversationTabState, normalizeNativeConversationTabHistory } from '../src/native-conversation-tab-state.mjs';
import { resolveStaticAsset } from '../src/static-assets.mjs';

function fixture(hasHost = true) {
  const elements = [], styleWrites = [];
  const host = {
    classList: { contains: value => hasHost && value === 'ms-auto' },
    querySelector: () => null,
    insertBefore(element) { element.parentElement = this; if (!elements.includes(element)) elements.push(element); }
  };
  const search = { parentElement: { parentElement: { parentElement: host } } };
  const documentRef = {
    querySelector(selector) { return selector.startsWith('button') ? search : elements[0] || null; },
    createElement(tag) {
      return { tag, attributes: {}, events: {}, style: { setProperty: (...args) => styleWrites.push(args) },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, callback) { this.events[name] = callback; }
      };
    }
  };
  return { documentRef, elements, styleWrites, host };
}

test('project manager header entry is a single accessible no-drag button', () => {
  const f = fixture(); let opens = 0, prevented = 0;
  const install = () => installNativeProjectManagementEntry(() => opens++, f.documentRef);
  const entry = install(); install(); install();
  assert.equal(f.elements.length, 1);
  assert.equal(entry.type, 'button');
  assert.equal(entry.attributes['aria-label'], '项目管理');
  assert.deepEqual(f.styleWrites, [
    ['-webkit-app-region', 'no-drag', 'important'], ['app-region', 'no-drag', 'important'], ['pointer-events', 'auto', 'important']
  ]);
  entry.events.click({ preventDefault() { prevented++; }, stopPropagation() { prevented++; } });
  assert.equal(opens, 1); assert.equal(prevented, 2);
  entry.parentElement = null;
  assert.equal(install(), entry);
  assert.equal(entry.parentElement, f.host);
});

test('project manager waits for the native header without adding a fallback', () => {
  const f = fixture(false);
  assert.equal(installNativeProjectManagementEntry(() => {}, f.documentRef), null);
  assert.equal(f.elements.length, 0);
});

test('project manager retains its route across tabs and frame recovery', () => {
  const state = new NativeConversationTabState();
  assert.equal(state.showConsole('projects').module, 'projects');
  assert.equal(normalizeNativeConversationTabHistory(state).consoleModule, 'projects');
  const source = buildInjectionScript('http://127.0.0.1:47831');
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /module === 'projects'\) url.pathname = '\/projects.html'/);
  assert.match(source, /openWorkspace\('projects'\)/);
  assert.match(source, /'priority', 'projects'\]\.includes\(value.module\)/);
  assert.match(source, /const modules = \['board', 'console', 'sessions', 'context', 'priority', 'projects', 'conversations', 'zotero'\]/);
  assert.match(source, /modules\.includes\(input\?\.consoleModule\)/);
  assert.match(source, /module === 'projects' \? '项目管理'/);
});

test('project manager assets are explicitly allowlisted', () => {
  assert.match(resolveStaticAsset('/projects.html').type, /^text\/html/);
  assert.match(resolveStaticAsset('/styles/projects.css').type, /^text\/css/);
  for (const name of ['model', 'view', 'index']) assert.match(resolveStaticAsset(`/features/projects/${name}.js`).type, /^text\/javascript/);
  assert.equal(resolveStaticAsset('/features/projects/private.js'), null);
  assert.equal(resolveStaticAsset('/features/projects/../secrets.js'), null);
});
