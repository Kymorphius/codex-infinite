import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalChoicePrompt } from '../public/features/terminal/prompt.js';

const screen = text => {
  const lines = text.split('\n');
  return { length: lines.length, viewportY: 0, rows: lines.length,
    getLine: index => ({ translateToString: () => lines[index] }) };
};

test('mirrors a visible Claude question and current selection without choosing for the user', () => {
  assert.deepEqual(terminalChoicePrompt(screen('Which approach should I take?\n❯ 1. Keep the current API\n  2. Migrate all callers\n  3. Type something else\nEnter to select · Esc to cancel')), {
    question: 'Which approach should I take?', selected: 0, preview: '',
    options: [{ number: 1, label: 'Keep the current API' }, { number: 2, label: 'Migrate all callers' }, { number: 3, label: 'Type something else' }]
  });
});

test('character-art examples between choices keep spaces and line breaks', () => {
  const prompt = terminalChoicePrompt(screen('Which layout?\n❯ 1. Columns\n   ┌─────┬─────┐\n   │ A   │ B   │\n   └─────┴─────┘\n  2. Rows\n   +-----------+\n   | A         |\n   +-----------+\nEnter to select'));
  assert.equal(prompt?.question, 'Which layout?');
  assert.deepEqual(prompt?.options.map(item => item.label), ['Columns', 'Rows']);
  assert.match(prompt.preview, /   │ A   │ B   │\n   └─────┴─────┘/u);
  assert.match(prompt.preview, /   \| A         \|/u);
});

test('mirrors a permission choice but ignores logs and menus without a selection cursor', () => {
  assert.equal(terminalChoicePrompt(screen('Allow this command?\n  1. Yes\n❯ 2. No'))?.selected, 1);
  assert.equal(terminalChoicePrompt(screen('Build output\n  1. one\n  2. two')), null);
  assert.equal(terminalChoicePrompt(screen('Code diff\n❯ 1. first\n  3. third')), null);
  assert.deepEqual(terminalChoicePrompt(screen('Allow this command?\n❯ 1. Yes\n  2. No'))?.options.map(item => item.label), ['Yes', 'No']);
});
