import fs from 'node:fs/promises';
// Normalize App Server catalog identities to the native sidebar's durable IDs.
export async function readProjectStateIdentities(filePaths = []) {
  const projectIds = new Map();
  const threadProjectIds = new Map();
  for (const file of filePaths) {
    let state;
    try { state = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const serverByNative = new Map();
    for (const [host, mapping] of Object.entries(state['app-server-project-id-by-legacy-project-id-by-host'] || {})) {
      if (!host.startsWith('local:')) continue;
      for (const [nativeId, serverId] of Object.entries(mapping || {})) {
        if (typeof serverId !== 'string') continue;
        if (!projectIds.has(serverId)) projectIds.set(serverId, nativeId);
        if (!serverByNative.has(nativeId)) serverByNative.set(nativeId, serverId);
      }
    }
    for (const [threadId, assignment] of Object.entries(state['thread-project-assignments'] || {})) {
      if (assignment?.projectKind !== 'local' || threadProjectIds.has(threadId)) continue;
      const serverId = serverByNative.get(assignment.projectId);
      if (serverId) threadProjectIds.set(threadId, serverId);
    }
  }
  return { projectIds, threadProjectIds };
}

export async function readChecklistProjectIds(filePaths = []) {
  return (await readProjectStateIdentities(filePaths)).projectIds;
}
