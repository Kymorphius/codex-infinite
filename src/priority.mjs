import { calculateProjectPriority } from "../public/core/project-priority.js";

export { calculateProjectPriority };

export function buildProjectPriorities(tasks, now = new Date()) {
  const grouped = new Map();
  for (const task of tasks || []) {
    const project = task?.project || "未归类";
    if (!grouped.has(project)) grouped.set(project, []);
    grouped.get(project).push(task);
  }

  return Array.from(grouped, ([project, projectTasks]) => {
    const rankedTasks = [...projectTasks].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
    return {
      project,
      taskCount: rankedTasks.length,
      activeTaskCount: rankedTasks.filter((task) => task.status === "active").length,
      latestTask: rankedTasks[0] ? { id: rankedTasks[0].id, title: rankedTasks[0].title } : null,
      ...calculateProjectPriority(rankedTasks, now)
    };
  }).sort((left, right) => (
    right.priorityScore - left.priorityScore
    || String(right.lastConversationAt || "").localeCompare(String(left.lastConversationAt || ""))
    || left.project.localeCompare(right.project, "zh-CN")
  ));
}
