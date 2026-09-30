import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { nativeChecklistStyles } from '../src/native-checklist-style.mjs';
import { installNativeConversationTabWheelPreferences } from '../src/native-conversation-tab-preferences.mjs';
import { installNativeDiscussionButton } from '../src/native-discussion-button.mjs';
import { installNativeProjectPathMenu } from '../src/native-project-path-menu.mjs';
import { installNativeProjectSearchActions } from '../src/native-project-search-actions.mjs';
import { buildNativeRemoteProjectCopyUiSource } from '../src/native-remote-project-copy-ui.mjs';
import { installNativeRestartNeedsEntry } from '../src/native-restart-needs-panel.mjs';
import { installNativeProjectSearch } from '../src/native-project-search.mjs';
import { createNativeTerminalActions } from '../src/native-terminal-actions.mjs';
import { TURN_ANNOTATION_STYLE } from '../src/native-turn-annotation-style.mjs';
import { installUnifiedSidebar } from '../src/native-unified-sidebar.mjs';

const surfaces = [
  ['checklist dialog', nativeChecklistStyles()],
  ['conversation preferences', installNativeConversationTabWheelPreferences.toString()],
  ['discussion feedback', installNativeDiscussionButton.toString()],
  ['project path feedback', installNativeProjectPathMenu.toString()],
  ['project search feedback', installNativeProjectSearchActions.toString()],
  ['remote project copy menus', buildNativeRemoteProjectCopyUiSource()],
  ['restart needs panel', installNativeRestartNeedsEntry.toString()],
  ['project search backdrop', installNativeProjectSearch.toString()],
  ['terminal actions', createNativeTerminalActions.toString()],
  ['turn annotations', TURN_ANNOTATION_STYLE],
  ['unified sidebar controls', installUnifiedSidebar.toString()]
];

function endOfVariable(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index++) {
    if (source[index] === '(') depth++;
    else if (source[index] === ')' && --depth === 0) return index + 1;
  }
  throw Error('Unclosed native surface variable');
}

function surfaceVariables(source) {
  const variables = [], marker = /var\(--color-surface[^,\s)]*,/g;
  let match;
  while ((match = marker.exec(source))) {
    const end = endOfVariable(source, match.index);
    variables.push(source.slice(match.index, end));
    marker.lastIndex = end;
  }
  return variables;
}

function resolveVariable(expression, theme) {
  if (!expression.startsWith('var(')) return expression.trim();
  const body = expression.slice(4, -1);
  const comma = body.indexOf(',');
  const token = body.slice(0, comma).trim();
  return theme[token] ?? resolveVariable(body.slice(comma + 1).trim(), theme);
}

// These fixtures deliberately omit the removed background-primary/secondary
// aliases. Native foreground and surfaces change together on a theme switch.
const themes = {
  light: { '--color-surface': '#ffffff', '--color-surface-elevated': '#fafafa', '--color-surface-elevated-secondary': '#f5f5f5', '--color-text': '#171717', '--color-text-primary': '#171717' },
  dark: { '--color-surface': '#212121', '--color-surface-elevated': '#2f2f2f', '--color-surface-elevated-secondary': '#353535', '--color-text': '#ececec', '--color-text-primary': '#ffffff' }
};

for (const [name, source] of surfaces) {
  test(`${name} uses native surfaces when legacy background aliases are absent`, () => {
    assert.doesNotMatch(source, /var\(--color-background-(?:primary|secondary)[,)]/);
    const variables = surfaceVariables(source);
    assert.ok(variables.length > 0, 'the control supplies a native surface');
    for (const theme of Object.values(themes)) {
      for (const expression of variables) {
        const token = expression.slice(4, expression.indexOf(','));
        assert.equal(resolveVariable(expression, theme), theme[token], 'theme surfaces must override the fixed dark compatibility fallback');
        const fallback = resolveVariable(expression, {});
        assert.match(fallback, /^#[\da-f]+$/i, 'keep the existing final literal fallback for older shells');
      }
    }
  });
}

test('auxiliary native text continues to use the shell foreground or inherit it', () => {
  for (const [name, source] of surfaces) {
    if (name === 'project search backdrop') continue; // Native row templates supply the foreground.
    assert.match(source, /color:(?:var\(--color-text(?:-primary)?(?:[,)]|\))|inherit)/, name);
  }
});

test('unified sidebar selection stays visible and readable in both native themes', () => {
  const source = installUnifiedSidebar.toString();
  assert.doesNotMatch(source, /--color-background-selected/);
  const [, selected, idle] = source.match(/background = enabled \? '([^']+)' : '([^']+)'/);
  const [, amount, surface] = selected.match(/^color-mix\(in srgb,currentColor ([\d.]+)%,(var\(.+\))\)$/);
  const fraction = Number(amount) / 100;
  const rgb = value => value.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
  const luminance = color => color.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  assert.ok(fraction > 0 && fraction < 1, 'selection tints the current theme surface');
  for (const theme of Object.values(themes)) {
    const foreground = rgb(theme['--color-text']);
    const background = rgb(resolveVariable(surface, theme));
    assert.equal(resolveVariable(idle, theme), theme['--color-surface']);
    const selectedColor = foreground.map((channel, index) => channel * fraction + background[index] * (1 - fraction));
    assert.notDeepEqual(selectedColor, background, 'selected and idle appearances remain distinct');
    const values = [luminance(foreground), luminance(selectedColor)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, 'selected text stays readable');
  }
});

test('project actions replace an older installer and reuse the new surface identity', () => {
  const window = { __cccProjectSearchActions: { version: '2026-09-23.3' } };
  const context = vm.createContext({ window });
  const source = `(${installNativeProjectSearchActions.toString()})();`;
  vm.runInContext(source, context);
  const installed = window.__cccProjectSearchActions;
  assert.equal(installed.version, '2026-09-30.layout-surface1');
  assert.equal(typeof installed.openFolder, 'function');
  vm.runInContext(source, context);
  assert.equal(window.__cccProjectSearchActions, installed);
});

test('project path menus clean up the previous generation before installing surface changes', () => {
  let disposed = 0, attached = 0;
  const window = { __codexControlConsoleProjectPathMenu: { version: '2026-09-26.terminal-conversations', ready: true, dispose: () => { disposed++; } }, electronBridge: { showContextMenu() {} } };
  const context = vm.createContext({ window, document: { addEventListener: () => { attached++; } } });
  const source = `(${installNativeProjectPathMenu.toString()})();`;
  vm.runInContext(source, context);
  assert.equal(disposed, 1);
  assert.equal(attached, 1);
  const installed = window.__codexControlConsoleProjectPathMenu;
  assert.equal(installed.version, '2026-09-30.layout-surface1');
  vm.runInContext(source, context);
  assert.equal(window.__codexControlConsoleProjectPathMenu, installed);
  assert.equal(attached, 1);
});
