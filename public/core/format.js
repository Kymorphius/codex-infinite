export function formatDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatDuration(value) {
  const hours = Number(value) / 3600000;
  if (!Number.isFinite(hours) || hours <= 0) return "不足 1 分钟";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`;
  if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} 小时`;
  return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)} 天`;
}

export function formatTokens(value) {
  const tokens = Number(value);
  return Number.isFinite(tokens) ? new Intl.NumberFormat("zh-CN").format(tokens) : "未知";
}

export function taskStatusLabel(task) {
  if (task.status === "active") return "进行中";
  if (task.status === "completed") return "已完成";
  if (task.status === "error" || task.status === "interrupted") return "异常";
  return "待处理";
}
