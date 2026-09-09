import fs from 'node:fs/promises';
import { constants } from 'node:fs';

const WINDOW_BYTES = 4 * 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_RESULT_CHARS = 32_000;
const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase();

function publicText(value) {
  let text = String(value || '');
  for (const tag of ['recommended_plugins', 'environment_context', 'in-app-browser-context',
    'permissions', 'apps_instructions', 'plugins_instructions', 'skills_instructions', 'oai-mem-citation']) {
    text = text.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
    .replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[REDACTED CREDENTIAL]');
}

export function projectGptMessage(record, byteOffset, { includeCommentary = false, maxMessageChars = 8000, query = '' } = {}) {
  const p = record?.payload;
  if (record?.type !== 'response_item' || p?.type !== 'message' || !['user', 'assistant'].includes(p.role)) return null;
  const phase = p.channel || p.phase || p.internal_chat_message_metadata_passthrough?.channel;
  if (p.role === 'assistant' && phase && !['final', 'final_answer', ...(includeCommentary ? ['commentary'] : [])].includes(phase)) return null;
  const content = Array.isArray(p.content) ? p.content : [];
  const text = publicText(content.filter(item => ['input_text', 'output_text', 'text'].includes(item?.type)).map(item => item.text || '').join('\n'));
  if (!text || (p.role === 'user' && /^(?:# AGENTS\.md instructions|<INSTRUCTIONS>|<context_window>|<system_reminder>)/i.test(text))) return null;
  const found = query ? normalize(text).indexOf(normalize(query)) : 0;
  if (found < 0) return null;
  const start = query && text.length > maxMessageChars ? Math.max(0, found - 250) : 0;
  const excerpt = text.slice(start, start + maxMessageChars);
  return { id: String(p.id || `byte:${byteOffset}`), byteOffset, timestamp: record.timestamp || null,
    role: p.role, phase: phase || null, text: excerpt, textOffset: start,
    truncated: start > 0 || start + excerpt.length < text.length, totalChars: text.length };
}

function decodeCursor(value, expected) {
  if (!value) return null;
  try {
    if (typeof value !== 'string' || value.length > 1500) throw Error();
    const c = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (c.v !== 1 || c.thread !== expected.thread || c.identity !== expected.identity ||
      c.query !== expected.query || c.commentary !== expected.commentary ||
      !Number.isSafeInteger(c.before) || c.before < 0 || !Number.isSafeInteger(c.size) ||
      c.before > c.size || c.size > expected.size) throw Error();
    return c;
  } catch { throw new Error('读取游标已失效或不属于这次查询，请不带游标重新读取。'); }
}

export async function readGptTranscript(filePath, { conversationId, cursor, query = '', limit = 20,
  includeCommentary = false, maxMessageChars = 8000, windowBytes = WINDOW_BYTES, maxScanBytes = MAX_SCAN_BYTES } = {}) {
  const handle = await fs.open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('会话历史不是普通文件。');
    const expected = { v: 1, thread: conversationId, identity: `${stat.dev}:${stat.ino}`,
      size: stat.size, query, commentary: includeCommentary };
    const previous = decodeCursor(cursor, expected);
    const snapshot = previous || expected;
    let before = previous?.before ?? stat.size, scannedBytes = 0, skippedRecords = 0, chars = 0;
    const messages = [];
    let full = false;
    while (before > 0 && scannedBytes < maxScanBytes && !full) {
      const start = Math.max(0, before - Math.min(windowBytes, maxScanBytes - scannedBytes));
      const buffer = Buffer.alloc(before - start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      if (bytesRead !== buffer.length) throw new Error('会话历史在读取过程中发生变化，请重新读取。');
      scannedBytes += bytesRead;
      const first = start === 0 ? 0 : buffer.indexOf(10) + 1;
      if (start > 0 && first === 0) { skippedRecords++; before = start; continue; }
      const lines = [];
      for (let a = first, b = first; b <= buffer.length; b++) {
        if (b === buffer.length || buffer[b] === 10) { if (b > a) lines.push({ start: a, end: b }); a = b + 1; }
      }
      let resume = start + first;
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i], offset = start + line.start;
        let record;
        try { record = JSON.parse(buffer.subarray(line.start, line.end).toString('utf8')); }
        catch { skippedRecords++; resume = offset; continue; }
        const message = projectGptMessage(record, offset, { query, includeCommentary, maxMessageChars });
        if (message && (messages.length >= limit || chars + message.text.length > MAX_RESULT_CHARS)) {
          // Stop after the unconsumed line, so the older page will include it.
          resume = start + line.end + (buffer[line.end] === 10 ? 1 : 0); full = true; break;
        }
        resume = offset;
        if (message) { messages.push(message); chars += message.text.length; }
      }
      before = full ? resume : start + first;
      if (!full && before === start + buffer.length) { skippedRecords++; before = start; }
    }
    const olderCursor = before > 0 ? Buffer.from(JSON.stringify({ ...snapshot, before })).toString('base64url') : null;
    return { messages: messages.reverse(), olderCursor, hasOlder: Boolean(olderCursor),
      snapshotBytes: snapshot.size, scannedBytes, skippedRecords,
      coverage: olderCursor ? 'partial-history; continue with olderCursor' : 'reached-start-of-history',
      order: 'chronological within page; pages move newest to oldest' };
  } finally { await handle.close(); }
}
