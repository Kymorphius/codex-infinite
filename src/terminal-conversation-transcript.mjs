import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { terminalConversationId } from './terminal-conversation-contract.mjs';

// Inspect only the managed UUID's transcript; never load Claude settings or credentials.
// withMessages: false matches Claude's own notion of an existing session. Claude writes mode and
// permission records before the first message, and then refuses `--session-id` for that id.
export async function hasClaudeTranscript({ userHome, sessionId, withMessages = true }) {
  sessionId = terminalConversationId(sessionId);
  const root = path.join(userHome, '.claude', 'projects');
  let directories, realRoot;
  try {
    realRoot = await fs.realpath(root);
    const realHome = await fs.realpath(userHome);
    if (!realRoot.startsWith(`${realHome}${path.sep}`)) return false;
    directories = await fs.readdir(root, { withFileTypes: true });
  }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (const directory of directories) {
    if (!directory.isDirectory()) continue;
    const candidate = path.join(root, directory.name, `${sessionId}.jsonl`);
    let handle;
    try {
      if (!(await fs.realpath(candidate)).startsWith(`${realRoot}${path.sep}`)) continue;
      handle = await fs.open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || !stat.size) continue;
      const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
        try {
          const record = JSON.parse(line);
          if (record.sessionId === sessionId && (!withMessages || ['user', 'assistant'].includes(record.type))) return true;
        } catch {}
      }
    } catch (error) { if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error; }
    finally { await handle?.close(); }
  }
  return false;
}
