import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_ANSWER_CHARS = 12_000;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function answerText(record) {
  const content = record?.message?.content;
  return Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n').trim() : '';
}

// The newest finished answer in a Claude transcript: the last assistant message that ended
// its turn (stop_reason end_turn), with the text blocks Claude wrote for it. Tool calls,
// thinking and side-chain records are never part of an answer.
export function latestClaudeAnswer(text) {
  const records = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const record = JSON.parse(line); if (record.type === 'assistant' && !record.isSidechain) records.push(record); } catch { /* partial or foreign line */ }
  }
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].message?.stop_reason !== 'end_turn') continue;
    const messageId = records[i].message.id;
    const parts = [];
    for (let j = i; j >= 0 && (j === i || (messageId && records[j].message?.id === messageId)); j--) {
      const part = answerText(records[j]); if (part) parts.unshift(part);
    }
    const body = parts.join('\n').replace(CONTROL, '').trim();
    if (body) return { turnId: String(records[i].uuid || messageId), text: body.slice(0, MAX_ANSWER_CHARS), at: records[i].timestamp || null };
  }
  return null;
}

// Read-only adapter over ~/.claude/projects/<dir>/<sessionId>.jsonl (never settings or credentials).
// `sessionIds(id)` lists the managed id and any continuation ids, newest first.
export function createClaudeAnswerSource({ userHome, sessionIds = async id => [id] }) {
  async function locate(sessionId) {
    const root = await fs.realpath(path.join(userHome, '.claude', 'projects')).catch(() => null);
    if (!root || !root.startsWith(`${await fs.realpath(userHome)}${path.sep}`)) return null;
    for (const directory of await fs.readdir(root, { withFileTypes: true })) {
      if (!directory.isDirectory()) continue;
      const candidate = path.join(root, directory.name, `${sessionId}.jsonl`);
      try { if ((await fs.realpath(candidate)).startsWith(`${root}${path.sep}`)) return candidate; }
      catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
    }
    return null;
  }
  return async function latest(conversationId) {
    for (const sessionId of await sessionIds(conversationId)) {
      const file = await locate(sessionId);
      if (!file) continue;
      const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const { size, isFile } = await handle.stat().then(stat => ({ size: stat.size, isFile: stat.isFile() }));
        if (!isFile) continue;
        const start = Math.max(0, size - TAIL_BYTES), buffer = Buffer.alloc(size - start);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        let content = buffer.subarray(0, bytesRead).toString('utf8');
        if (start > 0) content = content.slice(content.indexOf('\n') + 1); // drop the cut first line
        const answer = latestClaudeAnswer(content);
        if (answer) return answer;
      } finally { await handle.close(); }
    }
    return null;
  };
}
