import fs from 'node:fs/promises';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MAX_COMPANIONS = 512, MAX_SUMMARY_BYTES = 4096;

// Router-owned companion Claude sessions, one per Codex thread. Reads only the public
// session.json summary Router writes next to its private binding (see Router AGENTS.md);
// never binding.json, archives, or anything outside the companions root.
export function createClaudeCompanionSource({ routerStateDirectory }) {
  const root = routerStateDirectory ? path.join(routerStateDirectory, 'claude-companions') : null;
  const cache = new Map();
  async function read(threadId) {
    const directory = path.join(root, threadId), file = path.join(directory, 'session.json');
    const [dirStat, stat] = await Promise.all([fs.lstat(directory), fs.lstat(file)]);
    if (!dirStat.isDirectory() || !stat.isFile() || stat.size > MAX_SUMMARY_BYTES) return null;
    const key = `${stat.mtimeMs}:${stat.size}`, cached = cache.get(threadId);
    if (cached?.key === key) return cached.value;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    // Router publishes where Claude works (normally the conversation's project); an absent or
    // unusable value keeps the companion directory, as older summaries did.
    let cwd = directory;
    if (typeof data?.cwd === 'string' && path.isAbsolute(data.cwd) && data.cwd.length <= 4096 && !data.cwd.includes('\0')) {
      try { const real = await fs.realpath(data.cwd); if ((await fs.stat(real)).isDirectory()) cwd = real; } catch { /* Keep the companion directory. */ }
    }
    const value = data?.version === 1 && String(data.threadId).toLowerCase() === threadId && UUID.test(data.sessionId || '')
      ? { threadId, sessionId: data.sessionId.toLowerCase(), cwd } : null;
    cache.set(threadId, { key, value });
    return value;
  }
  return {
    async list() {
      if (!root) return [];
      let names;
      try {
        if (!(await fs.lstat(root)).isDirectory()) return [];
        names = await fs.readdir(root);
      } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const threads = names.filter(name => UUID.test(name) && name === name.toLowerCase()).slice(0, MAX_COMPANIONS);
      const found = await Promise.all(threads.map(threadId => read(threadId).catch(() => null)));
      for (const threadId of cache.keys()) if (!threads.includes(threadId)) cache.delete(threadId);
      return found.filter(Boolean);
    },
  };
}
