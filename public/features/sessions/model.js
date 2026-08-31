export function groupSessionsByDirectory(tasks = []) {
  const groups = new Map();
  for (const task of tasks) {
    const directory = typeof task.cwd === "string" && task.cwd.trim() ? task.cwd.trim() : "";
    const key = directory || "__unclassified__";
    if (!groups.has(key)) groups.set(key, { key, directory, project: task.project || "未归类", tasks: [] });
    groups.get(key).tasks.push(task);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    tasks: group.tasks.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
  })).sort((left, right) => (
    String(right.tasks[0]?.updatedAt || "").localeCompare(String(left.tasks[0]?.updatedAt || ""))
    || left.project.localeCompare(right.project, "zh-CN")
  ));
}

export function groupSessionsByDevice(devices = [], tasks = []) {
  const configured = new Map(devices.map((device) => [device.id, { ...device, tasks: [] }]));
  for (const task of tasks) {
    const device = task.device || devices[0] || { id: "local", name: "本机", kind: "local-codex", location: "本机", status: "connected" };
    if (!configured.has(device.id)) configured.set(device.id, { ...device, tasks: [] });
    configured.get(device.id).tasks.push(task);
  }
  return Array.from(configured.values()).filter((device) => device.tasks.length || device.status !== "connected").map((device) => ({
    ...device,
    projects: groupSessionsByDirectory(device.tasks),
    latestAt: device.tasks.reduce((latest, task) => String(task.updatedAt || "") > latest ? String(task.updatedAt || "") : latest, "")
  })).sort((left, right) => String(right.latestAt || "").localeCompare(String(left.latestAt || "")) || left.name.localeCompare(right.name, "zh-CN"));
}

export function filterSessions(tasks = [], { query = "", status = "all" } = {}) {
  const normalizedQuery = String(query).toLocaleLowerCase("zh-CN");
  return tasks.filter((task) => {
    const taskStatus = task.status === "interrupted" ? "error" : task.status;
    if (status !== "all" && taskStatus !== status) return false;
    if (!normalizedQuery) return true;
    return [task.title, task.project, task.cwd, task.model, task.id]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(normalizedQuery));
  });
}

export function isNativeDesktopOwner(device = {}) {
  return device.runtime?.authority === "owner-native-desktop";
}

export function deviceHostLabel(device = {}) {
  if (isNativeDesktopOwner(device)) return "完整 Codex 桌面宿主";
  return ["local-codex", "remote-codex"].includes(device.kind) ? "原生 Codex" : device.kind || "Codex 节点";
}

export function conversationOwnerLabel(task = {}) {
  const name = task.device?.name || "远端设备";
  return isNativeDesktopOwner(task.device) ? `${name} · 原生 Codex 执行` : `${name} · 远程`;
}

export function acceptedMessageLabel(task = {}, result = {}) {
  const name = task.device?.name || "远端设备";
  if (result.duplicate) return "消息已接收，正在同步进度";
  return result.executionAuthority === "owner-native-desktop" ? `${name} 的原生 Codex 已接收` : `${name} 已接收`;
}

const ACCESS_LABELS = Object.freeze({
  "full-access": "完全访问",
  workspace: "工作区访问",
  "read-only": "只读",
  custom: "自定义权限",
  unknown: "权限未记录"
});

const SERVICE_TIER_LABELS = Object.freeze({
  default: "速度 标准",
  priority: "速度 快速",
  ultrafast: "速度 极速"
});

function contextWindowLabel(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`;
  return value.toLocaleString("en-US");
}

export function presentSessionSettings(source = {}) {
  const model = typeof source.model === "string" && source.model.trim() ? source.model.trim() : null;
  const reasoningEffort = typeof source.reasoningEffort === "string" && source.reasoningEffort.trim() ? source.reasoningEffort.trim() : null;
  const serviceTier = Object.hasOwn(SERVICE_TIER_LABELS, source.serviceTier) ? source.serviceTier : null;
  const accessMode = Object.hasOwn(ACCESS_LABELS, source.accessMode) ? source.accessMode : "unknown";
  const accessDetails = [source.permissionProfile ? `配置 ${source.permissionProfile}` : null, source.approvalPolicy ? `审批 ${source.approvalPolicy}` : null].filter(Boolean).join(" · ");
  let contextText = "百万上下文 未记录";
  let contextTone = "unknown";
  if (source.contextOverrideState === "default") {
    contextText = "百万上下文 关";
    contextTone = "default";
  } else if (source.contextOverrideState === "extended") {
    const requested = Number(source.requestedContextWindow);
    contextText = requested >= 1_000_000 ? "百万上下文 开" : `扩展上下文 ${contextWindowLabel(requested) || "已开启"}`;
    contextTone = "enabled";
  }
  const observed = contextWindowLabel(Number(source.modelContextWindow));
  const requested = contextWindowLabel(Number(source.requestedContextWindow));
  return Object.freeze([
    Object.freeze({ key: "model", text: model || "模型未记录", tone: model ? "available" : "unknown", title: model ? `远端模型 ${model}` : "远端没有记录模型" }),
    Object.freeze({ key: "reasoning", text: reasoningEffort ? `推理 ${reasoningEffort}` : "推理未记录", tone: reasoningEffort ? "available" : "unknown", title: reasoningEffort ? `远端推理强度 ${reasoningEffort}` : "远端没有记录推理强度" }),
    Object.freeze({ key: "speed", text: serviceTier ? SERVICE_TIER_LABELS[serviceTier] : "速度未记录", tone: serviceTier ? "available" : "unknown", title: serviceTier ? `远端推理速度 ${serviceTier}` : "远端没有记录推理速度" }),
    Object.freeze({ key: "access", text: ACCESS_LABELS[accessMode], tone: accessMode === "unknown" ? "unknown" : "available", title: accessDetails || "远端没有记录访问权限" }),
    Object.freeze({ key: "context", text: contextText, tone: contextTone, title: [requested ? `请求 ${requested}` : null, observed ? `已观察 ${observed}` : null].filter(Boolean).join(" · ") || "远端没有记录上下文状态" })
  ]);
}
