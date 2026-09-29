import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hasClaudeTranscript } from '../src/terminal-conversation-transcript.mjs';

test('transcript probe matches only the managed UUID and actual conversation records', async t => {
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-transcript-')), sessionId = randomUUID();
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
  const directory = path.join(userHome, '.claude', 'projects', '-project'); await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${sessionId}.jsonl`);
  await fs.writeFile(file, `${JSON.stringify({ type: 'progress', sessionId })}\n${JSON.stringify({ type: 'user', sessionId: randomUUID() })}\n`);
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
  await fs.appendFile(file, `${JSON.stringify({ type: 'user', sessionId, message: { role: 'user', content: 'hello' } })}\n`);
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), true);
  await assert.rejects(hasClaudeTranscript({ userHome, sessionId: '../outside' }), { statusCode: 400 });
});

test('transcript probe rejects file, directory and project-root symlink escapes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-transcript-link-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const userHome = path.join(directory, 'home'), root = path.join(userHome, '.claude', 'projects');
  const external = path.join(directory, 'outside'), sessionId = randomUUID();
  await fs.mkdir(path.join(root, 'project'), { recursive: true }); await fs.mkdir(external);
  const file = path.join(external, `${sessionId}.jsonl`);
  await fs.writeFile(file, JSON.stringify({ type: 'user', sessionId }));
  await fs.symlink(file, path.join(root, 'project', `${sessionId}.jsonl`));
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
  await fs.symlink(external, path.join(root, 'linked-project'));
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
  await fs.rm(root, { recursive: true }); await fs.symlink(external, root);
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
});

test('a metadata-only session counts as existing when messages are not required', async t => {
  // Regression: Claude writes mode records before the first message and then rejects --session-id
  // ("Session ID … is already in use"), so the resume decision must not require messages.
  const userHome = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-transcript-meta-')), sessionId = randomUUID();
  t.after(() => fs.rm(userHome, { recursive: true, force: true }));
  const directory = path.join(userHome, '.claude', 'projects', 'D--333----------'); await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${sessionId}.jsonl`), [{ type: 'mode', mode: 'normal', sessionId }, { type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId }].map(item => JSON.stringify(item)).join('\n') + '\n');
  assert.equal(await hasClaudeTranscript({ userHome, sessionId }), false);
  assert.equal(await hasClaudeTranscript({ userHome, sessionId, withMessages: false }), true);
  assert.equal(await hasClaudeTranscript({ userHome, sessionId: randomUUID(), withMessages: false }), false);
});
