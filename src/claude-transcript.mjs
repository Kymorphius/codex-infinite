import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { terminalConversationId } from './terminal-conversation-contract.mjs';

const CHUNK_BYTES = 512 * 1024, FULL_SCAN_BYTES = 64 * 1024 * 1024, BACKFILL_BYTES = 64 * 1024 * 1024, MAX_CONTINUATIONS = 16, MAX_DEPTH = 4;
export const DEFAULT_CLAUDE_TITLE = 'Claude CLI';

// A message the person typed: not tool output, meta notes, command/system wrappers, or a
// prompt a program sent through `claude -p` (entrypoint sdk-cli, e.g. Router relaying a Codex turn).
export function claudeUserText(record, sessionId) {
  if (record?.type !== 'user' || record.sessionId !== sessionId || record.isMeta || record.toolUseResult !== undefined || record.entrypoint === 'sdk-cli') return '';
  const content = record.message?.content;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) && content.every(part => part?.type === 'text' || part?.type === 'image')
      ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : '';
  return typeof text === 'string' && text.trim() && !text.trimStart().startsWith('<') ? text : '';
}

// Latest /rename title wins over Claude's generated one; also tracks the last user
// message time and continuation pointers. Mutates and returns `found`.
export function scanClaudeTranscript(text, sessionId, found = emptySummary()) {
  for (const line of text.split('\n')) {
    if (!line.includes('"type":"')) continue;
    let record; try { record = JSON.parse(line); } catch { continue; }
    if (record?.type === 'continued-in' && record.sessionId === sessionId && typeof record.continuedInSessionId === 'string') {
      if (!found.continued.includes(record.continuedInSessionId)) found.continued.push(record.continuedInSessionId);
      continue;
    }
    if (record?.sessionId !== sessionId) continue;
    if (record.type === 'custom-title' && typeof record.customTitle === 'string') found.custom = record.customTitle;
    if (record.type === 'ai-title' && typeof record.aiTitle === 'string') found.generated = record.aiTitle;
    if (claudeUserText(record, sessionId) && Number.isFinite(Date.parse(record.timestamp))) found.lastUserAt = new Date(record.timestamp).toISOString();
  }
  return found;
}
export const emptySummary = () => ({ custom: '', generated: '', lastUserAt: '', continued: [] });
export function claudeTitleText(found) {
  return (found.custom || found.generated).replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 160);
}
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();

// Reads only managed session transcripts inside the real ~/.claude/projects, never
// settings or credentials. Summaries advance incrementally per file.
export function createClaudeTranscriptReader({ userHome, fullScanBytes = FULL_SCAN_BYTES, chunkBytes = CHUNK_BYTES }) {
  const states = new Map();
  async function root() {
    try {
      const real = await fs.realpath(path.join(userHome, '.claude', 'projects'));
      return real.startsWith(`${await fs.realpath(userHome)}${path.sep}`) ? real : null;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function locate(realRoot, sessionId) {
    for (const directory of await fs.readdir(realRoot, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const candidate = path.join(realRoot, directory.name, `${sessionId}.jsonl`);
      try { if ((await fs.realpath(candidate)).startsWith(`${realRoot}${path.sep}`)) return candidate; }
      catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
    }
    return null;
  }
  // A transcript too large to scan whole is read backwards, chunk by chunk, until the
  // latest typed message and title are found (bounded by BACKFILL_BYTES). A long tool
  // run can push the last typed message far past any fixed-size tail.
  async function backfill(handle, size, sessionId) {
    const found = emptySummary();
    let end = size, carry = Buffer.alloc(0), read = 0;
    while (end > 0 && read < BACKFILL_BYTES && !(found.lastUserAt && (found.custom || found.generated))) {
      const start = Math.max(0, end - chunkBytes), buffer = Buffer.alloc(end - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      let chunk = Buffer.concat([buffer.subarray(0, bytesRead), carry]);
      // Keep the partial first line for the next (earlier) chunk unless this is the file start.
      const cut = start > 0 ? chunk.indexOf(10) : -1;
      read += bytesRead; end = start;
      if (start > 0 && cut < 0) { carry = chunk; continue; }
      carry = cut >= 0 ? chunk.subarray(0, cut) : Buffer.alloc(0);
      if (cut >= 0) chunk = chunk.subarray(cut + 1);
      const part = scanClaudeTranscript(chunk.toString('utf8'), sessionId);
      for (const key of ['custom', 'generated', 'lastUserAt']) if (!found[key] && part[key]) found[key] = part[key];
      for (const id of part.continued) if (!found.continued.includes(id)) found.continued.push(id);
    }
    return found;
  }
  async function advance(file, sessionId) {
    const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) return null;
      let state = states.get(file);
      if (!state || stat.size < state.offset) {
        const large = stat.size > fullScanBytes;
        state = { offset: large ? stat.size : 0, found: large ? await backfill(handle, stat.size, sessionId) : emptySummary() };
        states.set(file, state);
      }
      while (state.offset < stat.size) {
        const length = Math.min(stat.size - state.offset, chunkBytes), buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
        const end = buffer.subarray(0, bytesRead).lastIndexOf(10);
        if (end < 0) { if (bytesRead < chunkBytes) break; state.offset += bytesRead; continue; }
        scanClaudeTranscript(buffer.subarray(0, end).toString('utf8'), sessionId, state.found);
        state.offset += end + 1;
      }
      return { file, sessionId, modified: stat.mtimeMs, found: state.found };
    } finally { await handle.close(); }
  }
  // Claude resumes into a fresh transcript and points the old one at it; the most
  // recently written reachable file holds the live conversation.
  async function resolve(sessionId) {
    sessionId = terminalConversationId(sessionId);
    const realRoot = await root(); if (!realRoot) return null;
    const visited = new Map(), queue = [[sessionId, 0]];
    while (queue.length && visited.size < MAX_CONTINUATIONS) {
      const [id, depth] = queue.shift();
      if (visited.has(id)) continue;
      let entry = null;
      try { const file = await locate(realRoot, terminalConversationId(id)); if (file) entry = await advance(file, id); }
      catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code) && error.statusCode !== 400) throw error; }
      visited.set(id, entry);
      if (entry && depth < MAX_DEPTH) for (const next of entry.found.continued) queue.push([next, depth + 1]);
    }
    const entries = [...visited.values()].filter(Boolean);
    if (!entries.length) return null;
    const live = entries.reduce((best, entry) => entry.modified > best.modified ? entry : best);
    const origin = visited.get(sessionId);
    const custom = found => claudeTitleText({ custom: found.custom, generated: '' });
    return { ...live, ids: [...visited.keys()], title: claudeTitleText(live.found) || (origin ? claudeTitleText(origin.found) : ''),
      customTitle: custom(live.found) || (origin ? custom(origin.found) : ''), lastUserAt: live.found.lastUserAt || origin?.found.lastUserAt || '' };
  }
  async function summary(sessionId) {
    const resolved = await resolve(sessionId);
    // resumeId is the live file's session: resuming the managed id would reload the
    // conversation only up to its first continuation and fork an old branch.
    // customTitle is only what the person set with /rename (a generated title may describe a program's prompt).
    return resolved ? { title: resolved.title, customTitle: resolved.customTitle, lastUserMessageAt: resolved.lastUserAt || null, ids: resolved.ids, resumeId: resolved.sessionId }
      : { title: '', customTitle: '', lastUserMessageAt: null, ids: [terminalConversationId(sessionId)], resumeId: null };
  }
  async function search(sessionId, rawQuery) {
    const query = normalize(rawQuery).trim(), resolved = query && await resolve(sessionId);
    if (!resolved) return null;
    const lines = readline.createInterface({ input: (await import('node:fs')).createReadStream(resolved.file, { encoding: 'utf8', end: FULL_SCAN_BYTES }), crlfDelay: Infinity });
    let match = null;
    try {
      for await (const line of lines) {
        if (!normalize(line).includes(query)) continue;
        let record; try { record = JSON.parse(line); } catch { continue; }
        const text = claudeUserText(record, resolved.sessionId), position = normalize(text).indexOf(query);
        if (position < 0) continue;
        const start = Math.max(0, position - 65);
        match = { excerpt: (start ? '…' : '') + text.slice(start, start + 190) + (start + 190 < text.length ? '…' : ''), at: record.timestamp || null };
      }
    } finally { lines.close(); }
    return match;
  }
  return { summary, search, resolve };
}
