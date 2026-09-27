import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { terminalConversationId } from './terminal-conversation-contract.mjs';

const TAIL_BYTES = 512 * 1024, FULL_SCAN_BYTES = 16 * 1024 * 1024;
export const DEFAULT_CLAUDE_TITLE = 'Claude CLI';

// Latest user-set (/rename) title wins over Claude's generated title. Titles are
// user content; only a bounded, control-free single line is returned.
export function scanClaudeTitles(text, sessionId, found = { custom: '', generated: '' }) {
  for (const line of text.split('\n')) {
    if (!line.includes('-title"')) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record?.sessionId !== sessionId) continue;
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') found.custom = record.customTitle;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') found.generated = record.aiTitle;
  }
  return found;
}

export function claudeTitleText(found) {
  return (found.custom || found.generated).replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 160);
}

// Reads only the managed UUID's transcript inside ~/.claude/projects, never settings
// or credentials. Title state is cached per session and advanced incrementally.
export function createClaudeTitleReader({ userHome }) {
  const cache = new Map();
  async function locate(root, sessionId) {
    let realRoot, directories;
    try {
      realRoot = await fs.realpath(root);
      if (!realRoot.startsWith(`${await fs.realpath(userHome)}${path.sep}`)) return null;
      directories = await fs.readdir(root, { withFileTypes: true });
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    for (const directory of directories) {
      if (!directory.isDirectory()) continue;
      const candidate = path.join(root, directory.name, `${sessionId}.jsonl`);
      try { if ((await fs.realpath(candidate)).startsWith(`${realRoot}${path.sep}`)) return candidate; }
      catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
    }
    return null;
  }
  // Incremental: each call reads only bytes appended since the last complete line.
  async function read(file, sessionId) {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return '';
      let state = cache.get(sessionId);
      if (!state || state.file !== file || stat.size < state.offset) {
        // First read: whole file when bounded, else only its tail.
        state = { file, offset: stat.size > FULL_SCAN_BYTES ? stat.size - TAIL_BYTES : 0, found: { custom: '', generated: '' } };
        cache.set(sessionId, state);
      }
      while (state.offset < stat.size) {
        const length = Math.min(stat.size - state.offset, TAIL_BYTES), buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
        const end = buffer.subarray(0, bytesRead).lastIndexOf(10);
        if (end < 0) { if (bytesRead < TAIL_BYTES) break; state.offset += bytesRead; continue; }
        scanClaudeTitles(buffer.subarray(0, end).toString('utf8'), sessionId, state.found);
        state.offset += end + 1;
      }
      return claudeTitleText(state.found);
    } finally { await handle.close(); }
  }
  return async function titleFor(sessionId) {
    sessionId = terminalConversationId(sessionId);
    const file = await locate(path.join(userHome, '.claude', 'projects'), sessionId);
    if (!file) return '';
    try { return await read(file, sessionId); }
    catch (error) { if (['ENOENT', 'ELOOP'].includes(error.code)) return ''; throw error; }
  };
}
