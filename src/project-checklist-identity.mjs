import fs from 'node:fs/promises';
// Normalize App Server catalog identities to the native sidebar's durable IDs.
export async function readChecklistProjectIds(filePaths = []) {
  const ids = new Map();
  for (const file of filePaths) {
    let state;
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const [host, mapping] of Object.entries(state['app-server-project-id-by-legacy-project-id-by-host'] || {})) {
      if (!host.startsWith('local:')) continue;
      for (const [nativeId, serverId] of Object.entries(mapping || {})) {
        if (typeof serverId === 'string' && !ids.has(serverId)) ids.set(serverId, nativeId);
      }
    }
  }
  return ids;
}
