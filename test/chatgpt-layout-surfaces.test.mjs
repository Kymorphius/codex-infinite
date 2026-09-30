import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeConversationTabStyle } from '../src/native-conversation-tab-style.mjs';
import { NATIVE_RECENT_CONVERSATION_STYLE } from '../src/native-recent-conversations.mjs';
import { NATIVE_TERMINAL_MODEL_PICKER_STYLE } from '../src/native-terminal-model-picker-style.mjs';
import { NATIVE_TERMINAL_VIEW_STYLE } from '../src/native-terminal-view-style.mjs';

const shortcutSelector = '[data-codex-control-console-conversation-shortcuts]';
const tabStyle = buildNativeConversationTabStyle('[data-tabs]', 'data-title-hidden', '', '');

function rule(style, selector) {
  const start = style.indexOf(selector + '{');
  assert.notEqual(start, -1, 'expected a rule for ' + selector);
  return style.slice(start + selector.length + 1, style.indexOf('}', start));
}

function declaration(styleRule, property) {
  const value = styleRule.split(';').find((item) => item.trim().startsWith(property + ':'));
  assert.ok(value, 'expected a declaration for ' + property);
  return value.trim().slice(property.length + 1);
}

// Resolve nested variable fallbacks against a document theme, without requiring
// the retired background aliases that are absent from the current app shell.
function resolveVariables(value, theme) {
  let result = value;
  while (result.includes('var(')) {
    const next = result.replace(/var\((--[\w-]+)(?:,([^()]*))?\)/g,
      (_, token, fallback) => theme[token] ?? fallback ?? '');
    assert.notEqual(next, result, 'expected a resolvable CSS variable expression');
    result = next;
  }
  return result;
}

const shortcut = rule(tabStyle, shortcutSelector);
const recentMenu = rule(NATIVE_RECENT_CONVERSATION_STYLE, '.ccc-native-recent-menu');
const terminalMenu = rule(NATIVE_TERMINAL_MODEL_PICKER_STYLE, '.model-menu');
const terminalForeground = declaration(rule(NATIVE_TERMINAL_VIEW_STYLE, ':host'), '--fg');

test('enhanced native controls no longer depend on retired background aliases', () => {
  for (const style of [tabStyle, NATIVE_RECENT_CONVERSATION_STYLE, NATIVE_TERMINAL_MODEL_PICKER_STYLE]) {
    assert.doesNotMatch(style, /--color-background-(?:primary|secondary)/);
  }
  assert.match(shortcut, /--ccc-shortcut-surface/);
  assert.match(shortcut, /--color-surface-secondary/);
  assert.match(recentMenu, /--color-surface-elevated/);
  assert.match(terminalMenu, /--color-surface-elevated/);
});

for (const [name, nativeTheme] of Object.entries({
  light: { '--color-surface': '#ffffff', '--color-surface-secondary': '#f3f3f3', '--color-surface-elevated': '#ffffff', '--color-text': '#202020' },
  dark: { '--color-surface': '#202022', '--color-surface-secondary': '#2b2b2b', '--color-surface-elevated': '#303032', '--color-text': '#eeeeee' }
})) {
  test('native ' + name + ' theme keeps each surface paired with its native foreground', () => {
    const theme = { ...nativeTheme, '--fg': resolveVariables(terminalForeground, nativeTheme) };
    for (const [styleRule, token] of [[shortcut, '--color-surface-secondary'], [recentMenu, '--color-surface-elevated'], [terminalMenu, '--color-surface-elevated']]) {
      assert.equal(resolveVariables(declaration(styleRule, 'background'), theme), theme[token]);
      assert.equal(resolveVariables(declaration(styleRule, 'color'), theme), theme['--color-text']);
    }
  });
}

test('computed composer surface wins and native base surface backs up missing secondary tokens', () => {
  assert.equal(resolveVariables(declaration(shortcut, 'background'), {
    '--ccc-shortcut-surface': 'rgb(246, 246, 246)', '--color-surface-secondary': '#333333'
  }), 'rgb(246, 246, 246)');
  for (const styleRule of [shortcut, recentMenu, terminalMenu]) {
    assert.equal(resolveVariables(declaration(styleRule, 'background'), { '--color-surface': '#fafafa' }), '#fafafa');
  }
});

test('surface adaptation preserves shortcut and menu placement and native overlay stacking', () => {
  assert.match(shortcut, /position:fixed;z-index:41;/);
  assert.match(shortcut, /min-height:36px/);
  assert.match(shortcut, /border-radius:16px/);
  assert.match(recentMenu, /position:absolute;bottom:34px;left:0;/);
  assert.match(recentMenu, /width:min\(360px,calc\(100vw - 32px\)\)/);
  assert.match(terminalMenu, /position:absolute;right:0;bottom:calc\(100% \+ 10px\);z-index:6;/);
  assert.match(NATIVE_TERMINAL_MODEL_PICKER_STYLE, /\.model-menu:popover-open\{position:fixed;inset:auto;margin:0;z-index:auto\}/);
  assert.match(tabStyle, /@container ccc-native-shortcuts \(max-width:430px\)/);
  assert.match(tabStyle, /left:0;right:auto;width:100%;box-sizing:border-box/);
  assert.match(tabStyle, /@media\(max-width:720px\)/);
});
