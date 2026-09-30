import fs from 'node:fs/promises';
import path from 'node:path';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

// Claude registers each running interactive session as ~/.claude/sessions/<pid>.json.
// Only those JSON registrations are read (never the adjacent .key files), and an entry
// counts only while its process is alive.
export function createClaudeSessionOccupancy({ userHome, isAlive = alive, ttlMs = 2000, now = () => Date.now(), fsImpl = fs }) {
  let cached = null;
  async function registrations(fresh = false) {
    if (!fresh && cached && now() - cached.at < ttlMs) return cached.items;
    const items = [];
    let root;
    try {
      root = await fsImpl.realpath(path.join(userHome, '.claude', 'sessions'));
      if (!root.startsWith(`${await fsImpl.realpath(userHome)}${path.sep}`)) root = null;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const name of root ? await fsImpl.readdir(root) : []) {
      if (!/^\d{1,10}\.json$/.test(name)) continue;
      try {
        const file = path.join(root, name), stat = await fsImpl.lstat(file);
        if (!stat.isFile() || stat.size > 64 * 1024) continue;
        const value = JSON.parse(await fsImpl.readFile(file, 'utf8'));
        if (Number.isSafeInteger(value?.pid) && value.pid > 1 && `${value.pid}.json` === name && typeof value.sessionId === 'string') items.push({ pid: value.pid, sessionId: value.sessionId.toLowerCase(), ...(['busy', 'idle'].includes(value.status) ? { status: value.status } : {}),
          ...(Number.isSafeInteger(value.startedAt) && value.startedAt > 0 ? { startedAt: value.startedAt } : {}),
          ...(value.kind === 'bg' && /^[0-9a-f]{8}$/u.test(value.jobId || '') ? { jobId: value.jobId } : {}),
          // Router's per-turn `claude -p` registers as sdk-cli: a Codex turn in progress.
          ...(value.entrypoint === 'sdk-cli' ? { codexTurn: true } : {}) });
      } catch { /* A registration being rewritten is read again next time. */ }
    }
    cached = { at: now(), items };
    return items;
  }
  const filterHolders = (items, sessionIds) => {
    const wanted = new Set([...sessionIds].map(id => String(id).toLowerCase()));
    return items.filter(item => wanted.has(item.sessionId) && isAlive(item.pid));
  };
  const holders = async (sessionIds, fresh) => filterHolders(await registrations(fresh), sessionIds);
  async function occupiedBy(sessionIds) { return (await holders(sessionIds, false))[0] || null; }
  // Every live holder of the chain, read fresh; used by takeover.
  occupiedBy.all = sessionIds => holders(sessionIds, true);
  // One list's rows share fresh registrations, but recheck liveness when each row projects them.
  // Action checks must use .all instead; this snapshot has no lifetime beyond its caller's list.
  occupiedBy.snapshot = async () => {
    const items = await registrations(true);
    return sessionIds => filterHolders(items, sessionIds).map(item => ({ ...item }));
  };
  return occupiedBy;
}
