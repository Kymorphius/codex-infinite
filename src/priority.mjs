const HOUR_MS = 60 * 60 * 1000;
const RECENCY_WINDOW_MS = 7 * 24 * HOUR_MS;

function timestamp(value) {
  const milliseconds = Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function sessionRuntimeMs(task, nowMs) {
  const startedAt = timestamp(task?.createdAt);
  if (startedAt === null) return 0;
  const recordedEnd = timestamp(task?.updatedAt);
  const endedAt = task?.status === "active" ? nowMs : recordedEnd;
  if (endedAt === null || endedAt <= startedAt) return 0;
  return endedAt - startedAt;
}

export function calculateProjectPriority(tasks, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const validNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  let totalRuntimeMs = 0;
  let lastConversationMs = null;
  let recentSessionCount = 0;

  for (const task of tasks || []) {
    const updatedAt = timestamp(task?.updatedAt);
    if (updatedAt !== null) {
      const ageMs = Math.max(0, validNowMs - updatedAt);
      if (ageMs <= RECENCY_WINDOW_MS) recentSessionCount += 1;
      lastConversationMs = lastConversationMs === null ? updatedAt : Math.max(lastConversationMs, updatedAt);
    }
    totalRuntimeMs += sessionRuntimeMs(task, validNowMs);
  }

  const latestAgeMs = lastConversationMs === null ? null : Math.max(0, validNowMs - lastConversationMs);
  const latestConversationWeight = latestAgeMs === null ? 0 : Math.round(70 * Math.exp(-latestAgeMs / RECENCY_WINDOW_MS));
  const recentSessionBonus = Math.min(15, recentSessionCount * 3);
  const recencyWeight = Math.min(85, latestConversationWeight + recentSessionBonus);
  const runtimeHours = totalRuntimeMs / HOUR_MS;
  const runtimeWeight = Math.min(15, Math.round(Math.log2(1 + runtimeHours) * 3));
  return {
    priorityScore: recencyWeight + runtimeWeight,
    recencyWeight,
    latestConversationWeight,
    recentSessionBonus,
    runtimeWeight,
    recentSessionCount,
    totalRuntimeMs,
    lastConversationAt: lastConversationMs === null ? null : new Date(lastConversationMs).toISOString()
  };
}

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
