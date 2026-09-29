import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { observeClaudeSettings, mergeClaudeSettingsObservations, adoptClaudeSettings, observedClaudeSettings } from '../src/claude-transcript-settings.mjs';
import { createClaudeTranscriptReader } from '../src/claude-transcript.mjs';

const at = minute => `2026-09-29T10:${String(minute).padStart(2, '0')}:00.000Z`;
const assistant = (model, effort, minute, extra = {}) => ({ type: 'assistant', effort, timestamp: at(minute), message: { model, content: [] }, ...extra });
const command = (name, args, minute) => ({ type: 'user', timestamp: at(minute),
  message: { content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<command-args>${args}</command-args>` } });
const observe = records => records.reduce((observed, record) => observeClaudeSettings(record, observed), {});

test('observation keeps the last main-thread reply and /model, /effort, ultracode commands', () => {
  const observed = observe([assistant('claude-opus-5-5', 'high', 1), command('effort', 'ultracode', 2), command('model', 'Sonnet', 3),
    assistant('claude-sonnet-5-5', 'medium', 4), assistant('claude-haiku-4-5-20251001', 'low', 5, { isSidechain: true }),
    assistant('<synthetic>', null, 6), command('effort', 'max', 7), command('effort', '', 8), command('effort', 'ultracode off', 9)]);
  assert.deepEqual(observed.assistant, { model: 'claude-sonnet-5-5', effort: 'medium', at: at(4) });
  assert.deepEqual(observed.modelCommand, { value: 'sonnet', at: at(3) });
  assert.deepEqual(observed.effortCommand, { value: 'max', at: at(7) });
  assert.deepEqual(observed.ultracode, { value: false, at: at(9) });
  const merged = mergeClaudeSettingsObservations([observe([command('effort', 'low', 20)]), observed]);
  assert.deepEqual(merged.effortCommand, { value: 'low', at: at(20) }, 'newest evidence per kind wins across a chain');
});

test('only evidence newer than the stored choice is adopted, in time order', () => {
  const current = { model: 'opus', effort: 'high', ultracode: false, updatedAt: at(10) };
  assert.equal(adoptClaudeSettings(current, observe([command('effort', 'low', 5), assistant('claude-sonnet-5-5', 'low', 9)])), null,
    'older replies never revert a fresh picker choice');
  assert.deepEqual(adoptClaudeSettings(current, observe([command('effort', 'low', 11), command('effort', 'ultracode', 12)])),
    { model: 'opus', effort: 'low', ultracode: true, updatedAt: at(12) });
  assert.deepEqual(adoptClaudeSettings(current, observe([command('model', 'claude-sonnet-5-5', 11), assistant('claude-sonnet-5-5', 'high', 12)])),
    { model: 'sonnet', effort: 'high', ultracode: false, updatedAt: at(12) });
  assert.equal(adoptClaudeSettings(current, observe([assistant('claude-opus-5-5', 'high', 12)])), null, 'a matching reply changes nothing');
  assert.equal(adoptClaudeSettings(null, observe([command('effort', 'low', 11)])), null, 'records without a choice are not written');
});

test('aliases and auto effort survive resolved replies', () => {
  const alias = { model: 'opus-latest', effort: 'auto', ultracode: false, updatedAt: at(10) };
  assert.equal(adoptClaudeSettings(alias, observe([command('model', 'opus', 11), assistant('claude-opus-5-5', 'medium', 12)])), null,
    'the alias and auto are kept although Claude reports the resolved model and default level');
  assert.deepEqual(adoptClaudeSettings(alias, observe([command('effort', 'high', 11), assistant('claude-opus-5-5', 'high', 12)])),
    { model: 'opus-latest', effort: 'high', ultracode: false, updatedAt: at(12) });
  assert.deepEqual(adoptClaudeSettings({ ...alias, model: 'opus', effort: 'high' }, observe([command('model', 'haiku', 11)])),
    { model: 'haiku-latest', effort: 'auto', ultracode: false, updatedAt: at(11) }, 'auto-only models force auto');
});

test('explicit /model commands win over wildcard and 1M aliases; a plain /effort ends ultracode', () => {
  const stored = (model, extra = {}) => ({ model, effort: 'auto', ultracode: false, updatedAt: at(10), ...extra });
  assert.equal(adoptClaudeSettings(stored('default'), observe([command('model', 'claude-sonnet-5-5', 11)])).model, 'sonnet');
  assert.equal(adoptClaudeSettings(stored('best'), observe([command('model', 'claude-sonnet-5-5', 11)])).model, 'sonnet');
  assert.equal(adoptClaudeSettings(stored('opus-1m'), observe([command('model', 'claude-opus-5-5', 11)])).model, 'opus');
  assert.equal(adoptClaudeSettings(stored('default'), observe([assistant('claude-sonnet-5-5', null, 11)])), null, 'a reply is still explained by the alias');
  const ultra = stored('sonnet', { effort: 'high', ultracode: true });
  assert.deepEqual(adoptClaudeSettings(ultra, observe([command('effort', 'low', 11)])), { model: 'sonnet', effort: 'low', ultracode: false, updatedAt: at(11) });
  assert.deepEqual(adoptClaudeSettings(ultra, observe([command('effort', 'low', 11), command('effort', 'ultracode', 12)])),
    { model: 'sonnet', effort: 'low', ultracode: true, updatedAt: at(12) }, 'turned on again afterwards');
});

test('an unset model stays unset through replies; only /model sets it', () => {
  const unset = { model: null, effort: 'high', ultracode: false, updatedAt: at(10) };
  assert.equal(adoptClaudeSettings(unset, observe([assistant('claude-opus-5-5', 'high', 11)])), null, 'Claude\'s default explains any reply');
  assert.deepEqual(adoptClaudeSettings(unset, observe([command('model', 'fable', 11)])), { model: 'fable', effort: 'high', ultracode: false, updatedAt: at(11) });
  assert.deepEqual(adoptClaudeSettings(unset, observe([command('effort', 'max', 11)])), { model: null, effort: 'max', ultracode: false, updatedAt: at(11) });
});

test('observed settings describe what Claude used for records without a choice', () => {
  assert.equal(observedClaudeSettings({}), null);
  assert.deepEqual(observedClaudeSettings(observe([assistant('claude-opus-5-5', 'medium', 1)])), { model: 'opus', effort: 'medium', ultracode: null });
  assert.deepEqual(observedClaudeSettings(observe([assistant('claude-opus-4-1', 'low', 1), command('effort', 'ultracode', 2)])), { model: null, effort: 'low', ultracode: true });
});

test('observed ultracode counts only after the running Claude started; it is off otherwise', () => {
  const observed = observe([assistant('claude-opus-5-5', 'medium', 1), command('effort', 'ultracode', 2)]);
  const expect = ultracode => ({ model: 'opus', effort: 'medium', ultracode });
  assert.deepEqual(observedClaudeSettings(observed, { runningSince: Date.parse(at(1)) }), expect(true), 'turned on in this process');
  assert.deepEqual(observedClaudeSettings(observed, { runningSince: Date.parse(at(3)) }), expect(false), 'a resumed process starts without it');
  assert.deepEqual(observedClaudeSettings(observed, { runningSince: null }), expect(false), 'nothing runs');
  assert.deepEqual(observedClaudeSettings(observed, { runningSince: 0 }), expect(true), 'unknown start keeps the evidence');
  assert.deepEqual(observedClaudeSettings(observe([assistant('claude-opus-5-5', 'medium', 1)]), { runningSince: null }), expect(false));
});

test('transcript summary reports settings evidence from the live chain', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-settings-')); t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const directory = path.join(userHome, '.claude', 'projects', '-work'), id = randomUUID(); await fs.mkdir(directory, { recursive: true });
  const lines = [command('effort', 'ultracode', 1), assistant('claude-opus-5-5', 'high', 2)].map(record => JSON.stringify({ ...record, sessionId: id }) + '\n').join('');
  await fs.writeFile(path.join(directory, `${id}.jsonl`), lines);
  const summary = await createClaudeTranscriptReader({ userHome }).summary(id);
  assert.deepEqual(summary.settings.ultracode, { value: true, at: at(1) });
  assert.deepEqual(summary.settings.assistant, { model: 'claude-opus-5-5', effort: 'high', at: at(2) });
  assert.equal(summary.title, '', 'command records never become the title');
});

test('a large transcript is backfilled until older settings evidence is found', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-settings-')); t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const directory = path.join(userHome, '.claude', 'projects', '-work'), id = randomUUID(); await fs.mkdir(directory, { recursive: true });
  const filler = minute => ({ type: 'user', timestamp: at(minute), message: { content: 'x'.repeat(300) } });
  const records = [command('effort', 'low', 1), ...Array.from({ length: 20 }, (_, index) => filler(2 + index)),
    { type: 'ai-title', aiTitle: 'Big', timestamp: at(30) }, assistant('claude-opus-5-5', 'low', 31)];
  await fs.writeFile(path.join(directory, `${id}.jsonl`), records.map(record => JSON.stringify({ ...record, sessionId: id }) + '\n').join(''));
  const summary = await createClaudeTranscriptReader({ userHome, fullScanBytes: 1024, chunkBytes: 512 }).summary(id);
  assert.deepEqual(summary.settings.effortCommand, { value: 'low', at: at(1) }, 'found many chunks before the last reply');
  assert.deepEqual(summary.settings.assistant, { model: 'claude-opus-5-5', effort: 'low', at: at(31) });
});
