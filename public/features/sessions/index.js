import { isLocalTask } from "../../core/tasks.js";

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

export function createSessionsFeature({ state, $, formatDate, statusLabel, requestOpen }) {
  const panel = $('[data-module-panel="sessions"]');
  const list = $('[data-testid="session-project-list"]');
  const search = $('[data-testid="session-search"]');
  const statusFilter = $('[data-testid="session-status-filter"]');
  const filterEmpty = $('[data-testid="session-filter-empty"]');
  const filter = { query: "", status: "all" };

  function sessionRow(task) {
    const row = document.createElement("article");
    row.className = "session-row";
    row.dataset.sessionId = task.id;
    const main = document.createElement("div");
    main.className = "session-row-main";
    const heading = document.createElement("div");
    heading.className = "session-row-heading";
    const status = document.createElement("span");
    status.className = "session-status";
    status.dataset.status = task.boardStatus || "pending";
    status.textContent = statusLabel(task);
    const title = document.createElement("h4");
    title.textContent = task.title;
    heading.append(status, title);
    const meta = document.createElement("div");
    meta.className = "session-row-meta";
    const details = [task.model || "模型未记录", task.reasoningEffort ? `推理 ${task.reasoningEffort}` : null, `更新 ${formatDate(task.updatedAt)}`].filter(Boolean);
    for (const text of details) {
      const item = document.createElement("span");
      item.textContent = text;
      meta.append(item);
    }
    main.append(heading, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "task-open session-open";
    const local = isLocalTask(task);
    open.textContent = local ? "打开原生对话" : "由远端节点打开";
    open.disabled = !local;
    if (local) open.addEventListener("click", () => requestOpen(task));
    row.append(main, open);
    return row;
  }

  function projectCard(group, index) {
    const card = document.createElement("details");
    card.className = "session-project-card";
    card.open = index === 0;
    card.dataset.directory = group.directory;
    const summary = document.createElement("summary");
    const identity = document.createElement("div");
    identity.className = "session-project-identity";
    const name = document.createElement("h3");
    name.textContent = group.project;
    const directory = document.createElement("code");
    directory.textContent = group.directory || "未记录工作目录";
    identity.append(name, directory);
    const stats = document.createElement("div");
    stats.className = "session-project-stats";
    const activeCount = group.tasks.filter((task) => task.status === "active").length;
    for (const text of [`${group.tasks.length} 个会话`, activeCount ? `${activeCount} 个进行中` : "当前无进行中", `最近 ${formatDate(group.tasks[0]?.updatedAt)}`]) {
      const item = document.createElement("span");
      item.textContent = text;
      stats.append(item);
    }
    summary.append(identity, stats);
    const rows = document.createElement("div");
    rows.className = "session-row-list";
    rows.replaceChildren(...group.tasks.map(sessionRow));
    card.append(summary, rows);
    return card;
  }

  function deviceCard(device, index) {
    const card = document.createElement("section");
    card.className = "session-device-card";
    card.dataset.deviceId = device.id;
    const header = document.createElement("header");
    header.className = "session-device-header";
    const identity = document.createElement("div");
    identity.className = "session-device-identity";
    const name = document.createElement("h3");
    name.textContent = device.name || "未知设备";
    const source = document.createElement("span");
    source.textContent = `${device.location || "远程"} · ${["local-codex", "remote-codex"].includes(device.kind) ? "原生 Codex" : device.kind || "Codex 节点"}`;
    identity.append(name, source);
    const status = document.createElement("span");
    status.className = "session-device-status";
    status.dataset.status = device.status || "unknown";
    status.textContent = device.status === "connected" ? "已连接" : device.status === "error" ? "异常" : "未连接";
    header.append(identity, status);
    const projects = document.createElement("div");
    projects.className = "session-device-projects";
    projects.replaceChildren(...device.projects.map((project, projectIndex) => projectCard(project, index === 0 ? projectIndex : projectIndex + 1)));
    card.append(header, projects);
    return card;
  }

  function render() {
    const tasks = filterSessions(state.tasks, filter);
    list.replaceChildren(...groupSessionsByDevice(state.devices, tasks).map(deviceCard));
    list.classList.toggle("hidden", state.taskStatus !== "connected" || tasks.length === 0);
    filterEmpty.classList.toggle("hidden", state.taskStatus !== "connected" || tasks.length > 0);
    $('[data-testid="session-result-count"]').textContent = filter.query || filter.status !== "all" ? `${tasks.length} 条匹配` : "最近更新优先";
  }

  function setTaskState(responseStatus, label) {
    for (const element of panel.querySelectorAll("[data-sessions-state]")) element.classList.toggle("hidden", element.getAttribute("data-sessions-state") !== responseStatus);
    const connected = responseStatus === "connected";
    const devices = connected ? groupSessionsByDevice(state.devices, state.tasks) : [];
    $('[data-testid="session-device-count"]').textContent = connected ? String(devices.length) : "—";
    $('[data-testid="session-project-count"]').textContent = connected ? String(devices.reduce((sum, device) => sum + device.projects.length, 0)) : "—";
    $('[data-testid="session-count"]').textContent = connected ? String(state.tasks.length) : "—";
    $('[data-testid="session-connection-status"]').textContent = label;
    list.classList.toggle("hidden", !connected);
  }

  function bind() {
    search.addEventListener("input", () => { filter.query = search.value.trim().slice(0, 200); render(); });
    statusFilter.addEventListener("change", () => { filter.status = statusFilter.value; render(); });
  }

  return { bind, render, setTaskState };
}
