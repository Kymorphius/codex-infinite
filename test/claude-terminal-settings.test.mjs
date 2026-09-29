import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { claudeTerminalCatalog, claudeTerminalSettingsInput, claudeTerminalSettingsStored, claudeLaunchArgs, claudeLaunchEnvironment,
  claudeSettingsCommands, claudeModelFromCommand, claudeModelFromReply, CLAUDE_TERMINAL_EFFORTS } from '../src/claude-terminal-settings.mjs';
import { terminalConversationRecord, terminalConversationUpdate } from '../src/terminal-conversation-contract.mjs';

const ID = '22222222-2222-4222-8222-222222222222';

test('catalog mirrors the Router families, CLI IDs and auto-only set, plus Fable, and is self-contained', () => {
  const { models, efforts, effortLabels } = claudeTerminalCatalog();
  assert.deepEqual(models.map(model => model.id), ['opus', 'sonnet', 'haiku', 'fable', 'opusplan', 'default', 'best',
    'opus-latest', 'sonnet-latest', 'haiku-latest', 'opusplan-latest', 'opus-1m', 'sonnet-1m']);
  const cli = Object.fromEntries(models.map(model => [model.id, model.cliModel]));
  assert.deepEqual([cli.opus, cli.sonnet, cli.haiku, cli.fable, cli['opus-1m'], cli['opus-latest']],
    ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001', 'claude-fable-5-1', 'opus[1m]', 'opus']);
  assert.deepEqual(models.filter(model => model.autoOnly).map(model => model.id), ['haiku', 'default', 'best', 'haiku-latest']);
  assert.equal(models.find(model => model.id === 'fable').name, 'Fable 5.1');
  assert.deepEqual(efforts, ['auto', 'low', 'medium', 'high', 'xhigh', 'max']); assert.deepEqual(CLAUDE_TERMINAL_EFFORTS, efforts);
  assert.deepEqual(Object.values(effortLabels), ['自动', '轻度', '中', '高', '极高', '最高']);
  const embedded = vm.runInContext(`(${claudeTerminalCatalog.toString()})()`, vm.createContext({}));
  assert.equal(embedded.models.length, models.length, 'the page picker can embed the catalog source');
});

test('settings input and record validate model, effort, auto-only and ultracode', () => {
  assert.deepEqual(claudeTerminalSettingsInput({ model: 'opus', effort: 'high', ultracode: true }), { model: 'opus', effort: 'high', ultracode: true });
  for (const input of [{ model: 'gpt-5', effort: 'auto', ultracode: false }, { model: 'opus', effort: 'ultra', ultracode: false },
    { model: 'haiku', effort: 'high', ultracode: false }, { model: 'opus', effort: 'low', ultracode: 'yes' }, { model: 'opus', effort: 'low', ultracode: false, extra: 1 }]) {
    assert.throws(() => claudeTerminalSettingsInput(input), { statusCode: 400 });
  }
  assert.deepEqual(claudeTerminalSettingsInput({ model: null, effort: 'high', ultracode: false }), { model: null, effort: 'high', ultracode: false },
    'an unset model keeps Claude\'s default');
  assert.throws(() => claudeTerminalSettingsInput({ effort: 'high', ultracode: false }), { statusCode: 400 });
});

test('stored settings are read leniently so a catalog change never breaks the registry', () => {
  const at = '2026-09-29T01:00:00.000Z';
  assert.deepEqual(claudeTerminalSettingsStored({ model: 'opus', effort: 'low', ultracode: true, updatedAt: at }), { model: 'opus', effort: 'low', ultracode: true, updatedAt: at });
  assert.deepEqual(claudeTerminalSettingsStored({ model: null, effort: 'max', ultracode: false, updatedAt: at }), { model: null, effort: 'max', ultracode: false, updatedAt: at });
  assert.equal(claudeTerminalSettingsStored({ model: 'retired-model', effort: 'high', ultracode: false, updatedAt: at }), null, 'a model no longer offered drops the choice');
  assert.deepEqual(claudeTerminalSettingsStored({ model: 'haiku', effort: 'high', ultracode: false, updatedAt: at }).effort, 'auto', 'now auto-only: effort becomes auto');
  assert.deepEqual(claudeTerminalSettingsStored({ model: 'opus', effort: 'ultra', ultracode: false, updatedAt: at }).effort, 'auto');
  for (const bad of [null, 'opus', [], { model: 'opus', effort: 'low', ultracode: 'yes', updatedAt: at }, { model: 'opus', effort: 'low', ultracode: false, updatedAt: 'later' }]) {
    assert.equal(claudeTerminalSettingsStored(bad), null);
  }
});

test('terminal records accept claudeSettings on Claude only and older records still load', () => {
  const base = { id: ID, provider: 'terminal', deviceId: 'device', cwd: '/work', kind: 'claude', title: 'Claude CLI', projectRef: null,
    pinned: false, archived: false, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z', revision: 1 };
  assert.equal('claudeSettings' in terminalConversationRecord(base, 'device'), false);
  const claudeSettings = { model: 'sonnet', effort: 'max', ultracode: false, updatedAt: '2026-09-29T01:00:00.000Z' };
  assert.deepEqual(terminalConversationRecord({ ...base, claudeSettings }, 'device').claudeSettings, claudeSettings);
  assert.equal('claudeSettings' in terminalConversationRecord({ ...base, kind: 'shell', title: '终端', claudeSettings }, 'device'), false, 'dropped on a shell');
  assert.equal('claudeSettings' in terminalConversationRecord({ ...base, claudeSettings: { ...claudeSettings, model: 'gone' } }, 'device'), false);
  const update = terminalConversationUpdate({ id: ID, expectedRevision: 1, claudeSettings: { model: 'opus-1m', effort: 'auto', ultracode: true } });
  assert.deepEqual(update.changes, { claudeSettings: { model: 'opus-1m', effort: 'auto', ultracode: true } });
  assert.throws(() => terminalConversationUpdate({ id: ID, expectedRevision: 1, claudeSettings: { model: 'opus', effort: 'auto', ultracode: true, updatedAt: 'x' } }), { statusCode: 400 });
});

test('launch args omit --effort for auto, and opusplan pins both versions', () => {
  assert.deepEqual(claudeLaunchArgs(null), []);
  assert.deepEqual(claudeLaunchArgs({ model: 'opus', effort: 'xhigh' }), ['--model', 'claude-opus-5-5', '--effort', 'xhigh']);
  assert.deepEqual(claudeLaunchArgs({ model: 'haiku', effort: 'auto', ultracode: true }), ['--model', 'claude-haiku-4-5-20251001']);
  assert.deepEqual(claudeLaunchArgs({ model: null, effort: 'high' }), ['--effort', 'high'], 'an unset model passes no --model');
  assert.deepEqual(claudeLaunchArgs({ model: null, effort: 'auto' }), []);
  assert.throws(() => claudeLaunchArgs({ model: 'opus; rm -rf ~', effort: 'auto' }), { statusCode: 400 });
  assert.deepEqual(claudeLaunchEnvironment({ model: 'opusplan' }), { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5-5', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5' });
  assert.deepEqual(claudeLaunchEnvironment({ model: 'opusplan-latest' }), {}); assert.deepEqual(claudeLaunchEnvironment(null), {});
});

test('command steps go from the running settings to the target, re-sending ultracode after an effort change', () => {
  const texts = (from, to) => claudeSettingsCommands(from, to).map(step => step.text);
  const opusHigh = { model: 'opus', effort: 'high', ultracode: false };
  assert.deepEqual(texts(opusHigh, opusHigh), []);
  assert.deepEqual(texts(opusHigh, { ...opusHigh, model: 'opus-1m' }), ['/model opus[1m]']);
  assert.deepEqual(texts(opusHigh, { ...opusHigh, effort: 'auto' }), ['/effort auto']);
  assert.deepEqual(texts(opusHigh, { ...opusHigh, ultracode: true }), ['/effort ultracode']);
  assert.deepEqual(texts({ ...opusHigh, ultracode: true }, { ...opusHigh, effort: 'max', ultracode: true }), ['/effort max', '/effort ultracode']);
  assert.deepEqual(texts({ ...opusHigh, ultracode: true }, opusHigh), ['/effort ultracode off']);
  assert.deepEqual(texts(null, { model: 'sonnet', effort: 'low', ultracode: false }), ['/model claude-sonnet-5-5', '/effort low']);
  assert.deepEqual(texts(null, { model: null, effort: 'low', ultracode: true }), ['/effort low', '/effort ultracode'], 'an unset model types no /model');
  const steps = claudeSettingsCommands(opusHigh, { model: 'fable', effort: 'max', ultracode: true });
  assert.deepEqual(steps.at(-1).settings, { model: 'fable', effort: 'max', ultracode: true });
  assert.deepEqual(claudeSettingsCommands(steps[0].settings, { model: 'fable', effort: 'max', ultracode: true }).map(step => step.text), ['/effort max', '/effort ultracode'],
    'recomputing after each typed command gives the same remaining steps');
});

test('assistant replies keep an alias that explains them; fixed versions match only their own ID', () => {
  assert.equal(claudeModelFromReply('claude-opus-5-5', 'opus-latest'), 'opus-latest');
  assert.equal(claudeModelFromReply('claude-opus-5-5', 'opus-1m'), 'opus-1m');
  assert.equal(claudeModelFromReply('claude-sonnet-5-5', 'opusplan'), 'opusplan');
  assert.equal(claudeModelFromReply('claude-haiku-4-5-20251001', 'default'), 'default');
  assert.equal(claudeModelFromReply('claude-sonnet-5-5', 'opus'), 'sonnet');
  assert.equal(claudeModelFromReply('claude-sonnet-4-5', 'sonnet'), null, 'a fixed version does not absorb another version of its family');
  assert.equal(claudeModelFromReply('claude-opus-4-1', 'sonnet'), null, 'an unknown model is ignored');
  assert.equal(claudeModelFromReply('', 'opus'), null);
});

test('/model arguments map exactly, whatever the current choice is', () => {
  assert.equal(claudeModelFromCommand('claude-sonnet-5-5', 'default'), 'sonnet', 'a wildcard alias does not swallow an explicit /model');
  assert.equal(claudeModelFromCommand('claude-sonnet-5-5', 'best'), 'sonnet');
  assert.equal(claudeModelFromCommand('claude-opus-5-5', 'opus-1m'), 'opus');
  assert.equal(claudeModelFromCommand('claude-opus-4-1', 'opus-latest'), null, 'an unlisted version cannot be represented');
  assert.equal(claudeModelFromCommand('opus', 'opus'), 'opus-latest', 'a /model alias argument is the alias choice');
  assert.equal(claudeModelFromCommand('opus', 'opus-latest'), 'opus-latest');
  assert.equal(claudeModelFromCommand('opusplan', 'opusplan-latest'), 'opusplan-latest');
  assert.equal(claudeModelFromCommand('opus[1m]', null), 'opus-1m');
  assert.equal(claudeModelFromCommand('fable', null), 'fable');
  assert.equal(claudeModelFromCommand(' ', 'opus'), null);
});
