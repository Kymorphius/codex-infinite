import fs from 'node:fs/promises';
import path from 'node:path';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Claude registers each running interactive session as ~/.claude/sessions/<pid>.json.
// Only those JSON registrations are read (never the adjacent .key files), and an entry
// counts only while its process is alive.
export function createClaudeSessionOccupancy({ userHome, isAlive = alive, ttlMs = 2000, now = () => Date.now() }) {
  let cached = null;
  async function registrations() {
    if (cached && now() - cached.at < ttlMs) return cached.items;
    const items = [];
    let root;
    try {
      root = await fs.realpath(path.join(userHome, '.claude', 'sessions'));
      if (!root.startsWith(`${await fs.realpath(userHome)}${path.sep}`)) root = null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of root ? await fs.readdir(root) : []) {
      if (!/^\d{1,10}\.json$/.test(name)) continue;
      try {
        const file = path.join(root, name), stat = await fs.lstat(file);
        if (!stat.isFile() || stat.size > 64 * 1024) continue;
        const value = JSON.parse(await fs.readFile(file, 'utf8'));
        if (Number.isSafeInteger(value?.pid) && value.pid > 1 && `${value.pid}.json` === name && typeof value.sessionId === 'string') items.push({ pid: value.pid, sessionId: value.sessionId.toLowerCase() });
      } catch { /* A registration being rewritten is read again next time. */ }
    }
    cached = { at: now(), items };
    return items;
  }
  return async function occupiedBy(sessionIds) {
    const wanted = new Set([...sessionIds].map(id => String(id).toLowerCase()));
    return (await registrations()).find(item => wanted.has(item.sessionId) && isAlive(item.pid)) || null;
  };
}
