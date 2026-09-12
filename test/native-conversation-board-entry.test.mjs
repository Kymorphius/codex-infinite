import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeConversationBoardEntry } from '../src/native-conversation-board-entry.mjs';
import { buildInjectionScript } from '../src/injection.mjs';
import { NativeConversationTabState, normalizeNativeConversationTabHistory } from '../src/native-conversation-tab-state.mjs';
import { resolveStaticAsset } from '../src/static-assets.mjs';

function fixture(hasHost = true) {
  const elements = [], writes = [];
  const host = { classList: { contains: value => hasHost && value === 'ms-auto' }, querySelector: () => null,
    insertBefore(element) { element.parentElement = this; if (!elements.includes(element)) elements.push(element); } };
  const search = { parentElement: { parentElement: { parentElement: host } } };
  const documentRef = { querySelector(selector) { return selector.startsWith('button') ? search : elements[0] || null; }, createElement() { return {
    attributes: {}, events: {}, style: { setProperty: (...args) => writes.push(args) }, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(name, callback) { this.events[name] = callback; }
  }; } };
  return { documentRef, elements, writes };
}

test('conversation board entry is idempotent, accessible and no-drag', () => {
  const f = fixture(); let opens = 0, stopped = 0;
  const install = () => installNativeConversationBoardEntry(() => opens++, f.documentRef);
  const entry = install(); install();
  assert.equal(f.elements.length, 1); assert.equal(entry.type, 'button'); assert.equal(entry.attributes['aria-label'], '会话看板');
  assert.deepEqual(f.writes, [['-webkit-app-region', 'no-drag', 'important'], ['app-region', 'no-drag', 'important'], ['pointer-events', 'auto', 'important']]);
  entry.events.click({ preventDefault() { stopped++; }, stopPropagation() { stopped++; } });
  assert.equal(opens, 1); assert.equal(stopped, 2);
});

test('conversation board waits for the native header', () => {
  const f = fixture(false); assert.equal(installNativeConversationBoardEntry(() => {}, f.documentRef), null); assert.equal(f.elements.length, 0);
});

test('conversation board route persists across tabs and frame recovery', () => {
  const state = new NativeConversationTabState(); assert.equal(state.showConsole('conversations').module, 'conversations');
  assert.equal(normalizeNativeConversationTabHistory(state).consoleModule, 'conversations');
  const source = buildInjectionScript('http://127.0.0.1:47831'); assert.doesNotThrow(() => new Function(source));
  assert.match(source, /module === 'conversations'\) url.pathname = '\/conversations.html'/);
  assert.match(source, /openWorkspace\('conversations'\)/); assert.match(source, /正在打开会话看板/);
});

test('conversation board assets are explicitly allowlisted', () => {
  assert.match(resolveStaticAsset('/conversations.html').type, /^text\/html/);
  assert.match(resolveStaticAsset('/styles/conversations.css').type, /^text\/css/);
  for (const name of ['model', 'index']) assert.match(resolveStaticAsset(`/features/conversations/${name}.js`).type, /^text\/javascript/);
  assert.equal(resolveStaticAsset('/features/conversations/private.js'), null);
});
