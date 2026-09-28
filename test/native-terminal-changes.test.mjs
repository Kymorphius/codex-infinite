import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as callback } from 'node:child_process';
import { promisify } from 'node:util';
import { parseNativeChangeStats, readNativeTerminalChanges } from '../src/native-terminal-changes.mjs';
const run = promisify(callback);

test('change parser bounds entries and preserves non-ASCII names without exposing untracked bytes', () => {
  assert.deepEqual(parseNativeChangeStats('3\t2\t修改.js\0', '密钥.env\0'), [
    { name: '修改.js', added: 3, removed: 2, untracked: false },
    { name: '密钥.env', added: 0, removed: 0, untracked: true }
  ]);
});

test('native change preview reads only the conversation directory through fixed Git operations', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ccc-change-preview-'));
  try {
    await run('git', ['init', '-q', dir]);
    await writeFile(path.join(dir, 'tracked.txt'), 'before\n');
    await run('git', ['-C', dir, 'add', '--', 'tracked.txt']);
    await run('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
    await writeFile(path.join(dir, 'tracked.txt'), 'after\n');
    await writeFile(path.join(dir, 'untracked.txt'), 'private content\n');
    const listed = await readNativeTerminalChanges(dir);
    assert.deepEqual(listed.files.map(file => file.name), ['tracked.txt', 'untracked.txt']);
    const preview = await readNativeTerminalChanges(dir, 'tracked.txt');
    assert.match(preview.patch, /\+after/); assert.match(preview.patch, /-before/);
    const unknown = await readNativeTerminalChanges(dir, 'untracked.txt');
    assert.equal(unknown.patch, ''); assert.doesNotMatch(JSON.stringify(unknown), /private content/);
    await assert.rejects(readNativeTerminalChanges(dir, '../outside'), /不在当前会话/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('non-Git directories report a clear empty state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ccc-change-preview-'));
  try { const result = await readNativeTerminalChanges(dir); assert.equal(result.files.length, 0); assert.match(result.unavailable, /Git/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test('new Git directories without a first commit still list untracked files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ccc-change-preview-'));
  try {
    await run('git', ['init', '-q', dir]);
    await writeFile(path.join(dir, 'new.txt'), 'new content\n');
    const result = await readNativeTerminalChanges(dir);
    assert.deepEqual(result.files.map(file => file.name), ['new.txt']);
    assert.equal(result.files[0].untracked, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
