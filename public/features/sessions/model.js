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
