import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { findSentMatchesInRoots, SentMessageSearchService } from '../src/sent-message-search-service.mjs';

test('root search runs the resolved ripgrep once and reuses it', async () => {
  let resolved = 0; const commands = [];
  const service = new SentMessageSearchService({
    catalog: { sessionRoots: ['/sessions'], async snapshot() { return { truncated: false, conversations: [{ id: 'one', title: 'One', transcriptPath: '/sessions/one.jsonl' }] }; } },
    resolveRipgrep: async () => { resolved++; return 'C:\\app\\resources\\rg.exe'; },
    fastSearch: async (_roots, _query, _allowed, options) => { commands.push(options.command); return { matches: new Map(), skipped: false }; }
  });
  await service.search('needle'); await service.search('other');
  assert.deepEqual([resolved, commands], [1, ['C:\\app\\resources\\rg.exe', 'C:\\app\\resources\\rg.exe']]);
});

test('a missing ripgrep rejects the prefilter instead of crashing the service', async () => {
  // Regression: the spawn 'error' listener was attached after reading, so ENOENT was uncaught.
  await assert.rejects(findSentMatchesInRoots([os.tmpdir()], 'needle', new Set(),
    { command: path.join(os.tmpdir(), 'ccc-missing-rg-' + process.pid, 'rg') }), { code: 'ENOENT' });
});
