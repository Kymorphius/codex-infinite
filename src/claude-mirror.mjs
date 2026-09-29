import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 8000, TAIL_BYTES = 2 * 1024 * 1024, READ_BYTES = 8 * 1024 * 1024, MAX_ENTRIES = 400;
const clip = text => text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
const partsText = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(part => ['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('\n') : '';

// Router relays a Codex turn as one JSON prompt {input:[...]}; what the person typed in Codex is the
// run of user messages at its end. Context envelopes (<environment_context>, AGENTS.md) are skipped.
export function codexPromptText(text) {
  let prompt;
  try { prompt = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(prompt?.input)) return null;
  const typed = [];
  for (let index = prompt.input.length - 1; index >= 0; index--) {
    const item = prompt.input[index];
    if (item?.role !== 'user' || (item.type && item.type !== 'message')) break;
    const value = partsText(item.content).trim();
    if (value && !value.startsWith('<') && !value.startsWith('# AGENTS.md instructions')) typed.unshift(value);
  }
  return typed.join('\n\n');
}

function toolBrief(part) {
  const input = part.input && typeof part.input === 'object' ? part.input : {};
  const detail = [input.description, input.command, input.file_path, input.pattern, input.url, input.query].find(value => typeof value === 'string' && value.trim());
  return `${String(part.name || '工具')}${detail ? ` · ${detail.replace(/\s+/gu, ' ').trim().slice(0, 240)}` : ''}`;
}

// One transcript record -> the lines a person reads: Codex/terminal messages, Claude's replies and
// tool calls. Thinking, tool results, subagent sidechains and metadata are not shown.
export function claudeMirrorEntries(record, sessionId) {
  if (!record || record.sessionId !== sessionId || record.isSidechain || record.isMeta) return [];
  const key = String(record.uuid || record.timestamp || ''), at = typeof record.timestamp === 'string' ? record.timestamp : null;
  const content = record.message?.content;
  if (record.type === 'user') {
    if (Array.isArray(content) && content.some(part => part?.type === 'tool_result')) return [];
    const text = partsText(content).trim();
    if (!text) return [];
    if (record.entrypoint === 'sdk-cli') {
      const codex = codexPromptText(text);
      // A plain one-shot prompt is a message sent from this console's mirror.
      if (codex === null) return [{ key, at, role: 'you', text: clip(text) }];
      return codex ? [{ key, at, role: 'codex', text: clip(codex) }] : [];
    }
    return text.startsWith('<') ? [] : [{ key, at, role: 'you', text: clip(text) }];
  }
  if (record.type !== 'assistant' || !Array.isArray(content)) return [];
  return content.flatMap((part, index) => part?.type === 'text' && part.text?.trim() ? [{ key: `${key}:${index}`, at, role: 'claude', text: clip(part.text.trim()) }]
    : part?.type === 'tool_use' ? [{ key: `${key}:${index}`, at, role: 'tool', text: toolBrief(part) }] : []);
}

// The transcript file of one session inside the real ~/.claude/projects, or null.
export async function locateClaudeTranscript(userHome, sessionId) {
  let root;
  try {
    root = await fs.realpath(path.join(userHome, '.claude', 'projects'));
    if (!root.startsWith(`${await fs.realpath(userHome)}${path.sep}`)) return null;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const directory of await fs.readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(root, directory.name, `${sessionId}.jsonl`);
    try { if ((await fs.realpath(candidate)).startsWith(`${root}${path.sep}`)) return candidate; }
    catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
  }
  return null;
}

// Entries appended since `cursor` ({sessionId, offset}); without one (or for another session, or a
// shrunk file) the last TAIL_BYTES. Only complete lines are consumed, so a line being written is
// read on the next call.
export async function readClaudeMirror({ file, sessionId, cursor = null, tailBytes = TAIL_BYTES, readBytes = READ_BYTES, maxEntries = MAX_ENTRIES }) {
  if (!file) return { entries: [], cursor: { sessionId, offset: 0 }, truncated: false };
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const size = (await handle.stat()).size;
    const resume = cursor?.sessionId === sessionId && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0 && cursor.offset <= size;
    let start = resume ? cursor.offset : Math.max(0, size - tailBytes);
    const length = Math.min(size - start, readBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    // A tail read starts mid-line: drop the fragment before the first newline.
    if (!resume && start > 0) { const cut = text.indexOf('\n'); start += cut < 0 ? bytesRead : Buffer.byteLength(text.slice(0, cut + 1)); text = cut < 0 ? '' : text.slice(cut + 1); }
    const last = text.lastIndexOf('\n'), complete = last < 0 ? '' : text.slice(0, last + 1);
    const entries = [];
    for (const line of complete.split('\n')) {
      if (!line.includes('"sessionId"')) continue;
      try { entries.push(...claudeMirrorEntries(JSON.parse(line), sessionId)); } catch { /* A malformed line is skipped. */ }
    }
    const truncated = entries.length > maxEntries || (!resume && start > 0);
    return { entries: entries.slice(-maxEntries), cursor: { sessionId, offset: start + Buffer.byteLength(complete) }, truncated };
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes(error.code)) return { entries: [], cursor: { sessionId, offset: 0 }, truncated: false };
    throw error;
  } finally { await handle?.close(); }
}
