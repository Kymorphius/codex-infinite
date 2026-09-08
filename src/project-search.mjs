function uniqueProjectRoot(roots) {
  if (!Array.isArray(roots) || !roots.length || roots.some(root => typeof root?.path !== 'string' || !root.path.trim())) return null;
  const paths = [...new Set(roots.map(root => root.path))];
  return paths.length === 1 ? paths[0] : null;
}
export function buildProjectSearchCatalog(ordered, tasks, matchProject) {
  const projects = ordered.map(({ project }) => ({ id: project.id, name: String(project.name || '未命名项目').slice(0, 160), sourceDirectory: uniqueProjectRoot(project.roots), sourceDirectories: [...new Set((project.roots || []).map(root => root.path).filter(path => typeof path === 'string' && path.trim()))], tasks: [] }));
  const byId = new Map(projects.map(project => [project.id, project]));
  const seen = new Set();
  for (const task of tasks) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.id || '') || seen.has(task.id) || task.archived) continue;
    seen.add(task.id);
    byId.get(matchProject(task)?.id)?.tasks.push({ id: task.id, title: String(task.title || '未命名会话').slice(0, 160) });
  }
  return projects;
}
export function filterProjectNames(projects, query) {
  const normalized = String(query || '').normalize('NFKC').trim().toLocaleLowerCase();
  return normalized ? projects.filter(project => String(project.name).normalize('NFKC').toLocaleLowerCase().includes(normalized)) : [];
}
