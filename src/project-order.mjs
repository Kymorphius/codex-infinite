import path from "node:path";
import { calculateProjectPriority } from "./priority.mjs";

function normalizedRoot(value) {
  if (typeof value !== "string" || !value) return null;
  const clean = value.replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "");
  const api = /^[A-Za-z]:[\\/]/.test(clean) || clean.startsWith("\\\\") ? path.win32 : path.posix;
  return api.isAbsolute(clean) ? { api, value: api.resolve(clean) } : null;
}

function contains(root, cwd) {
  if (root.api !== cwd.api) return false;
  const relative = root.api.relative(root.value, cwd.value);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${root.api.sep}`) && !root.api.isAbsolute(relative));
}

export function matchProjectForTask(projects, task) {
  const cwd = normalizedRoot(task?.cwd);
  if (!cwd) return null;
  let match = null;
  let matchLength = -1;
  for (const project of projects || []) {
    for (const root of project?.roots || []) {
      const rootPath = normalizedRoot(root?.path);
      if (rootPath && rootPath.value.length > matchLength && contains(rootPath, cwd)) {
        match = project;
        matchLength = rootPath.value.length;
      }
    }
  }
  return match;
}

export function buildNativeProjectOrder(projects, tasks, now = new Date()) {
  const nativeOrder = [...(projects || [])].sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const tasksByProject = new Map(nativeOrder.map((project) => [project.id, []]));
  for (const task of tasks || []) {
    const project = matchProjectForTask(nativeOrder, task);
    if (project) tasksByProject.get(project.id).push(task);
  }
  const scored = [];
  const unmatched = [];
  for (const project of nativeOrder) {
    const projectTasks = tasksByProject.get(project.id);
    if (projectTasks.length === 0) unmatched.push({ project, score: null });
    else scored.push({ project, score: calculateProjectPriority(projectTasks, now) });
  }
  scored.sort((left, right) => (
    right.score.priorityScore - left.score.priorityScore
    || String(right.score.lastConversationAt || "").localeCompare(String(left.score.lastConversationAt || ""))
    || left.project.position - right.project.position
    || left.project.id.localeCompare(right.project.id)
  ));
  return [...scored, ...unmatched];
}

export function projectMovePlan(currentProjects, orderedProjects) {
  const current = [...(currentProjects || [])].sort((left, right) => left.position - right.position).map((project) => project.id);
  const desired = (orderedProjects || []).map((entry) => entry.project?.id || entry.id).filter(Boolean);
  if (current.length === desired.length && current.every((id, index) => id === desired[index])) return [];
  const moves = [];
  let beforeProjectId = null;
  for (let index = desired.length - 1; index >= 0; index -= 1) {
    moves.push({ projectId: desired[index], beforeProjectId });
    beforeProjectId = desired[index];
  }
  return moves;
}
