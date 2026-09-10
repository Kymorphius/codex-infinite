import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';

const whitespace = byte => byte === 32 || byte === 9 || byte === 10 || byte === 13;
function stringEnd(bytes, start) {
  for (let index = start + 1; index < bytes.length; index++) {
    if (bytes[index] === 92) index++;
    else if (bytes[index] === 34) return index + 1;
  }
  throw new Error('Unterminated history string');
}
function skipValue(bytes, start) {
  if (bytes[start] === 34) return stringEnd(bytes, start);
  if (bytes[start] !== 123 && bytes[start] !== 91) {
    let end = start;
    while (end < bytes.length && ![44, 125, 93].includes(bytes[end]) && !whitespace(bytes[end])) end++;
    return end;
  }
  let depth = 0;
  for (let index = start; index < bytes.length; index++) {
    if (bytes[index] === 34) index = stringEnd(bytes, index) - 1;
    else if (bytes[index] === 123 || bytes[index] === 91) depth++;
    else if (bytes[index] === 125 || bytes[index] === 93) { if (--depth === 0) return index + 1; }
  }
  throw new Error('Unterminated history object');
}
function propertySpan(bytes, names, start = 0) {
  while (whitespace(bytes[start])) start++;
  if (bytes[start] !== 123) return null;
  let cursor = start + 1;
  while (cursor < bytes.length) {
    while (whitespace(bytes[cursor]) || bytes[cursor] === 44) cursor++;
    if (bytes[cursor] === 125) return null;
    if (bytes[cursor] !== 34) throw new Error('Invalid history object key');
    const keyEnd = stringEnd(bytes, cursor);
    const key = JSON.parse(bytes.subarray(cursor, keyEnd).toString('utf8'));
    cursor = keyEnd;
    while (whitespace(bytes[cursor])) cursor++;
    if (bytes[cursor++] !== 58) throw new Error('Invalid history property');
    while (whitespace(bytes[cursor])) cursor++;
    if (key === names[0]) return names.length === 1 ? [cursor, skipValue(bytes, cursor)] : propertySpan(bytes, names.slice(1), cursor);
    cursor = skipValue(bytes, cursor);
  }
  return null;
}

// Patch only the transport identity field, leaving every other source byte intact.
export function rekeyNativeHistoryRecord(bytes, idMap) {
  const typeSpan = propertySpan(bytes, ['type']);
  if (!typeSpan) return bytes;
  const type = JSON.parse(bytes.subarray(...typeSpan).toString('utf8'));
  if (type !== 'event_msg' && type !== 'token_usage_record') return bytes;
  const span = propertySpan(bytes, ['payload', 'thread_id']);
  if (!span) return bytes;
  const oldId = JSON.parse(bytes.subarray(...span).toString('utf8'));
  const nextId = idMap[oldId];
  if (!nextId) return bytes;
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(nextId)) throw new Error('Invalid mapped transport identity');
  return Buffer.concat([bytes.subarray(0, span[0]), Buffer.from(JSON.stringify(nextId)), bytes.subarray(span[1])]);
}

export class CloneRecordTransform extends Transform {
  constructor(idMap, { originalBodyBytes, metadataHeader } = {}) {
    super(); this.idMap = idMap; this.pending = Buffer.alloc(0); this.first = true;
    this.bodyHash = createHash('sha256'); this.bodyBytes = 0; this.changedRecords = 0;
    this.originalBodyBytes = originalBodyBytes; this.metadataHeader = metadataHeader;
  }
  emitRecord(line) {
    const next = this.first ? (this.metadataHeader || line) : rekeyNativeHistoryRecord(line, this.idMap);
    if (next !== line) this.changedRecords++;
    if (!this.first) {
      const count = this.originalBodyBytes == null ? next.length : Math.max(0, Math.min(next.length, this.originalBodyBytes - this.bodyBytes));
      this.bodyHash.update(next.subarray(0, count)); this.bodyBytes += count;
    }
    this.first = false; this.push(next);
  }
  _transform(chunk, encoding, callback) {
    try {
      const bytes = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      let start = 0, newline;
      while ((newline = bytes.indexOf(10, start)) >= 0) { this.emitRecord(bytes.subarray(start, newline + 1)); start = newline + 1; }
      this.pending = Buffer.from(bytes.subarray(start));
      if (this.pending.length > 64 * 1024 * 1024) throw new Error('History record exceeds the 64 MiB migration limit');
      callback();
    } catch (error) { callback(error); }
  }
  _flush(callback) {
    try { if (this.pending.length) this.emitRecord(this.pending); callback(); } catch (error) { callback(error); }
  }
}
