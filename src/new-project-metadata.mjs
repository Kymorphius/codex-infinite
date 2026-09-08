import fs from 'node:fs/promises';

// Native migrations can recreate project records; legacy IDs retain real age.
export async function readOriginalProjectDates(filePaths = []) {
  const dates = new Map();
  for (const filePath of filePaths) {
    let state;
    try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const originals = state['local-projects'] || {};
    for (const [host, mappings] of Object.entries(state['app-server-project-id-by-legacy-project-id-by-host'] || {})) {
      if (!host.startsWith('local:')) continue;
      for (const [legacyId, serverId] of Object.entries(mappings || {})) {
        const createdAt = originals[legacyId]?.createdAt;
        if (typeof serverId !== 'string' || !Number.isFinite(createdAt) || createdAt <= 0) continue;
        dates.set(serverId, Math.min(dates.get(serverId) ?? Infinity, createdAt));
      }
    }
  }
  return dates;
}
