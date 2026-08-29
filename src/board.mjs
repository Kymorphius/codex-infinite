export const BOARD_COLUMNS = Object.freeze([
  Object.freeze({ key: "pending", label: "待处理" }),
  Object.freeze({ key: "active", label: "进行中" }),
  Object.freeze({ key: "completed", label: "已完成" }),
  Object.freeze({ key: "error", label: "异常" })
]);

export function projectNameFromCwd(cwd) {
  if (typeof cwd !== "string") return "未归类";
  const normalized = cwd.trim().replace(/[\\/]+$/, "");
  if (!normalized) return "未归类";
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || "未归类";
}

export function boardStatusFromTaskStatus(status) {
  if (status === "active") return "active";
  if (status === "completed") return "completed";
  if (status === "error" || status === "interrupted") return "error";
  return "pending";
}

export function enrichTaskForBoard(task) {
  return {
    ...task,
    project: projectNameFromCwd(task?.cwd),
    boardStatus: boardStatusFromTaskStatus(task?.status)
  };
}

