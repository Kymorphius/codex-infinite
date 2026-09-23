import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeConversationTabStyle } from '../src/native-conversation-tab-style.mjs';

test('native tab style extraction preserves layout, hiding and extension styles', () => {
  const style = buildNativeConversationTabStyle('[data-tabs]', 'data-title-hidden', '.transition{opacity:1}', '.extension{color:red}');
  assert.match(style, /\[data-title-hidden\]\{display:none!important\}/);
  assert.match(style, /\[data-tabs\]\{position:fixed;top:5px/);
  assert.match(style, /\.ccc-native-tab-list\{display:flex/);
  assert.match(style, /\.ccc-native-tab\{display:flex;height:26px/);
  assert.match(style, /\.transition\{opacity:1\}/);
  assert.match(style, /\.extension\{color:red\}/);
  assert.match(style, /@media\(max-width:720px\)/);
});
