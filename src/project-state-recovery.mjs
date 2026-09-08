import path from 'node:path';
function roots(items) {
  return (items || []).map(value => {
    const clean = String(value).replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    const windows = /^[a-z]:[\\/]/i.test(clean) || clean.startsWith('\\\\');
    return windows ? path.win32.resolve(clean).toLowerCase() : path.posix.resolve(clean);
  }).sort();
}
export function planMissingSidebarProjects({ retainedProjects = {}, retainedMappings = {}, activeProjects = {}, activeMappings = {}, serverProjects = [] }) {
  const servers = new Map(serverProjects.map(project => [project.id, project]));
  const projects = { ...activeProjects }; const mappings = { ...activeMappings };
  const recovered = []; const skipped = [];
  for (const [id, project] of Object.entries(retainedProjects)) {
    if (Object.hasOwn(activeProjects, id)) continue;
    const serverId = retainedMappings[id]; const server = servers.get(serverId);
    if (!server || project?.id !== id || project.name !== server.name || !project.rootPaths?.length
      || JSON.stringify(roots(project.rootPaths)) !== JSON.stringify(roots(server.roots?.map(root => root.path)))
      || (activeMappings[id] && activeMappings[id] !== serverId)) {
      skipped.push(id); continue;
    }
    projects[id] = project; mappings[id] = serverId;
    recovered.push({ id, serverId, name: project.name });
  }
  return { projects, mappings, recovered, skipped };
}
