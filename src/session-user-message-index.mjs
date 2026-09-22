import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inputSourceFromSessionRecord } from './session-input-source.mjs';

const fingerprint = buffer => createHash('sha256').update(buffer).digest('hex');
const identity = stat => `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`;
const signature = stat => `${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;

// Bounded structural JSON-prefix inspection: keys inside message strings cannot
// impersonate the record envelope. Only known non-user envelope types qualify.
function nonUserPrefix(buffer) {
  const text = buffer.toString('utf8');
  const stack = [];
  const fields = new Map();
  let cursor = 0;
  const valuePath = () => {
    const parent = stack.at(-1);
    return parent ? `${parent.path}${parent.path ? '.' : ''}${parent.array ? '[]' : parent.key}` : '';
  };
  const complete = () => { const parent = stack.at(-1); if (parent && !parent.array) parent.key = null; };
  while (cursor < text.length) {
    const char = text[cursor++];
    if (/\s|:|,/.test(char)) continue;
    if (char === '{' || char === '[') {
      if (stack.length >= 32) return false;
      stack.push({ path: valuePath(), array: char === '[', key: null });
      continue;
    }
    if (char === '}' || char === ']') { stack.pop(); complete(); continue; }
    if (char !== '"') {
      while (cursor < text.length && !/[,}\]\s]/.test(text[cursor])) cursor += 1;
      complete(); continue;
    }
    const start = cursor - 1;
    let closed = false;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor++] === '"') { closed = true; break; }
    }
    if (!closed) break;
    let value;
    try { value = JSON.parse(text.slice(start, cursor)); } catch { return false; }
    const parent = stack.at(-1);
    if (!parent) return false;
    if (!parent.array && parent.key === null) parent.key = value;
    else {
      const key = valuePath();
      if (['type', 'payload.type', 'payload.role'].includes(key)) fields.set(key, value);
      complete();
    }
  }
  const type = fields.get('type');
  const payloadType = fields.get('payload.type');
  if (['session_meta', 'turn_context', 'compacted'].includes(type)) return true;
  if (type === 'event_msg') return ['token_count', 'agent_message', 'agent_reasoning', 'task_started', 'task_complete', 'task_completed', 'turn_started', 'turn_complete', 'turn_aborted', 'thread_settings_applied'].includes(payloadType);
  if (type !== 'response_item') return false;
  return ['reasoning', 'function_call', 'function_call_output', 'custom_tool_call', 'custom_tool_call_output'].includes(payloadType)
    || (payloadType === 'message' && ['assistant', 'system', 'developer'].includes(fields.get('payload.role')));
}

function imageOnlyUser(record) {
  const payload = record?.payload;
  if (record?.type !== 'event_msg' || payload?.type !== 'user_message' || String(payload.message || '').trim()) return false;
  const kinds = payload.internal_chat_message_metadata_passthrough?.content_item_kinds;
  if (Array.isArray(kinds) && !kinds.some(kind => typeof kind === 'string' && kind.startsWith('user.'))) return false;
  return [payload.images, payload.local_images].some(images => Array.isArray(images) && images.length > 0);
}

function userTimestamp(line) {
  const record = JSON.parse(line);
  if (inputSourceFromSessionRecord(record) !== 'user' && !imageOnlyUser(record)) return null;
  const time = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  if (!Number.isFinite(time)) throw new Error('User record has no valid timestamp');
  return new Date(time).toISOString();
}

/** Read-only incremental JSONL index. Never retains message bodies between reads. */
export class SessionUserMessageIndex {
  constructor({ fsImpl = fs, chunkBytes = 64 * 1024, maxRecordBytes = 4 * 1024 * 1024 } = {}) {
    this.fs = fsImpl;
    this.chunkBytes = Math.max(1024, Math.min(1024 * 1024, chunkBytes));
    this.maxRecordBytes = Math.max(1024, maxRecordBytes);
    this.cache = new Map();
    this.pending = new Map();
  }

  read(sourceFile) {
    if (this.pending.has(sourceFile)) return this.pending.get(sourceFile);
    const pending = this.readFile(sourceFile).finally(() => this.pending.delete(sourceFile));
    this.pending.set(sourceFile, pending);
    return pending;
  }

  retain(sourceFiles) {
    const keep = new Set(sourceFiles);
    for (const file of this.cache.keys()) if (!keep.has(file)) this.cache.delete(file);
  }

  async boundary(handle, offset) {
    const size = Math.min(256, offset);
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await handle.read(buffer, 0, size, offset - size);
    if (bytesRead !== size) throw new Error('Session changed during indexing');
    return fingerprint(buffer);
  }

  async readFile(sourceFile) {
    const stat = await this.fs.stat(sourceFile);
    const previous = this.cache.get(sourceFile);
    if (previous?.signature === signature(stat)) return { ...previous.result };
    const handle = await this.fs.open(sourceFile, 'r');
    try {
      let state = previous && previous.identity === identity(stat) && stat.size > previous.size
        ? { ...previous } : null;
      if (state && await this.boundary(handle, state.offset) !== state.boundary) state = null;
      if (!state) state = { offset: 0, lastUserMessageAt: null, uncertain: false };
      const result = await this.scan(handle, state, stat.size);
      const after = await handle.stat();
      if (identity(after) !== identity(stat) || after.size < stat.size) throw new Error('Session changed during indexing');
      if (after.size === stat.size && signature(after) !== signature(stat)) throw new Error('Session changed during indexing');
      const boundary = await this.boundary(handle, result.offset);
      const complete = !result.uncertain && !result.partial;
      const value = { lastUserMessageAt: result.lastUserMessageAt, complete };
      this.cache.set(sourceFile, {
        ...result, boundary, identity: identity(stat), size: stat.size,
        signature: signature(stat), result: value
      });
      return { ...value };
    } finally {
      await handle.close();
    }
  }

  async scan(handle, state, size) {
    const result = { ...state, partial: false };
    let cursor = state.offset;
    let lineStart = cursor;
    let parts = [];
    let bytes = 0;
    let oversized = Boolean(state.discardPartial);
    let knownNonUser = Boolean(state.discardNonUser);
    let prefix = Buffer.alloc(0);
    const buffer = Buffer.alloc(this.chunkBytes);
    const add = part => {
      if (prefix.length < 16 * 1024) prefix = Buffer.concat([prefix, part.subarray(0, 16 * 1024 - prefix.length)]);
      bytes += part.length;
      if (bytes > this.maxRecordBytes) {
        if (!oversized) knownNonUser = nonUserPrefix(prefix);
        oversized = true; parts = [];
      }
      else if (!oversized && part.length) parts.push(Buffer.from(part));
    };
    while (cursor < size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - cursor), cursor);
      if (!bytesRead) throw new Error('Session changed during indexing');
      let start = 0;
      for (let i = buffer.indexOf(10, 0); i >= 0 && i < bytesRead; i = buffer.indexOf(10, start)) {
        add(buffer.subarray(start, i));
        if (oversized && !knownNonUser) result.uncertain = true;
        else if (!oversized) {
          const line = Buffer.concat(parts, bytes).toString('utf8').trim();
          if (line) {
            try {
              const timestamp = userTimestamp(line);
              if (timestamp && (!result.lastUserMessageAt || timestamp > result.lastUserMessageAt)) result.lastUserMessageAt = timestamp;
            } catch { result.uncertain = true; }
          }
        }
        lineStart = cursor + i + 1;
        parts = []; bytes = 0; oversized = false; knownNonUser = false; prefix = Buffer.alloc(0); start = i + 1;
      }
      add(buffer.subarray(start, bytesRead));
      cursor += bytesRead;
    }
    // Re-read a short unfinished line on append; retain offsets, never its contents.
    result.offset = lineStart;
    result.partial = cursor > lineStart;
    if (oversized && !knownNonUser) result.uncertain = true;
    result.discardPartial = oversized && result.partial;
    result.discardNonUser = result.discardPartial && knownNonUser;
    if (result.discardPartial) result.offset = cursor;
    return result;
  }
}
