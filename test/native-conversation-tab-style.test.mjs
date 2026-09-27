import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeConversationTabStyle } from '../src/native-conversation-tab-style.mjs';

test('native tab style extraction preserves layout, hiding and extension styles', () => {
  const style = buildNativeConversationTabStyle('[data-tabs]', 'data-title-hidden', '.transition{opacity:1}', '.extension{color:red}');
  assert.match(style, /\[data-title-hidden\]\{display:none!important\}/);
  assert.match(style, /\[data-tabs\]\{position:fixed;top:5px/);
  assert.match(style, /\.ccc-native-tab-list\{display:flex/);
  assert.match(style, /\.ccc-native-tab\{display:flex;height:28px/);
  assert.match(style, /box-shadow:inset 0 -1px 0/);
  assert.match(style, /\.transition\{opacity:1\}/);
  assert.match(style, /\.extension\{color:red\}/);
  assert.match(style, /@media\(max-width:720px\)/);
});

test('composer shortcuts use native surface tokens and quiet chrome with accessible controls', () => {
  const style = buildNativeConversationTabStyle('[data-tabs]', 'data-hidden', '', '');
  const rule = style.match(/\[data-codex-control-console-conversation-shortcuts\]\{([^}]+)\}/)[1];
  assert.match(rule, /border-radius:16px/);
  assert.match(rule, /--ccc-shortcut-surface/);
  assert.match(rule, /box-shadow:none;backdrop-filter:none/);
  assert.match(style, /min-height:30px/);
  assert.match(style, /font:400 13px\/20px/);
  assert.match(style, /prefers-reduced-motion:reduce/);
  assert.match(style, /@container ccc-native-shortcuts \(max-width:430px\)/);
  assert.match(style, /flex:1 1 0!important;min-width:0;justify-content:center/);
  assert.match(style, /left:0;right:auto;width:100%;box-sizing:border-box/);
});
