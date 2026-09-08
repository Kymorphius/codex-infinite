export const NEW_PROJECT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Inputs use epoch milliseconds; adapters own external timestamp conversion.
export function deriveNewProjects(ordered, previous = {}, now = Date.now()) {
  const lifecycle = { ...previous };
  const projects = [];
  for (const [index, entry] of ordered.entries()) {
    const { project, score } = entry;
    const prior = lifecycle[project.id];
    if (prior?.graduatedAt != null) continue;
    const createdAt = project.createdAt;
    if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now) continue;
    const expiresAt = createdAt + NEW_PROJECT_WEEK_MS;
    const topTen = score != null && index < 10;
    if (topTen || now >= expiresAt) {
      lifecycle[project.id] = { graduatedAt: now, reason: topTen ? 'top-ten' : 'one-week' };
      continue;
    }
    projects.push({ id: project.id, name: project.name, expiresAt, rank: score == null ? null : index + 1 });
  }
  return { projects, lifecycle };
}
