import { isLocalTask } from "../../core/tasks.js";
import { SessionDisclosureState, summarizeSessionDevice } from "./disclosure.js";
import { deviceHostLabel, deviceRoleLabel, filterSessions, groupSessionsByDevice, provisionalRemoteTaskReference, resolveRemoteTaskReference } from "./model.js";
import { createRemoteConversation } from "./remote-conversation.js";
import { createProjectCopyControl } from "./project-copy.js";
import { createConversationTabs } from "./conversation-tabs.js";

export function createSessionsFeature({ state, $, formatDate, statusLabel, requestOpen, fetchImpl = fetch }) {
  const panel = $('[data-module-panel="sessions"]');
  const list = $('[data-testid="session-project-list"]');
  const search = $('[data-testid="session-search"]');
  const statusFilter = $('[data-testid="session-status-filter"]');
  const clearFilter = $('[data-testid="session-clear-filter"]');
  const filterEmpty = $('[data-testid="session-filter-empty"]');
  let remoteConversation;
  const conversationTabs = createConversationTabs({
    element: $('[data-testid="workspace-session-tabs"]'),
    onActivateTask(task) { remoteConversation?.open(task); },
    onActivateHome() { remoteConversation?.close(); }
  });
  remoteConversation = createRemoteConversation({ $, formatDate, fetchImpl, onRequestClose: () => conversationTabs.showHome() });
  const projectCopy = createProjectCopyControl({ fetchImpl });
  const filter = { query: "", status: "all" };
  const disclosure = new SessionDisclosureState();
  let visibleDevices = [];

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
    open.textContent = local ? "打开原生对话" : "打开远端对话";
    open.addEventListener("click", () => local ? requestOpen(task) : conversationTabs.open(task));
    row.append(main, open);
    return row;
  }

  function projectCard(device, group, index) {
    const card = document.createElement("details");
    card.className = "session-project-card";
    card.open = disclosure.isProjectOpen(device.id, group.key, index === 0, filter);
    card.dataset.directory = group.directory;
    card.addEventListener("toggle", () => disclosure.setProjectOpen(device.id, group.key, card.open));
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
    const actions = document.createElement("div");
    actions.className = "session-project-actions";
    const copy = projectCopy.button(device, group);
    if (copy) actions.append(copy);
    actions.append(stats);
    summary.append(identity, actions);
    const rows = document.createElement("div");
    rows.className = "session-row-list";
    rows.replaceChildren(...group.tasks.map(sessionRow));
    card.append(summary, rows);
    return card;
  }

  function deviceCard(device) {
    const card = document.createElement("section");
    card.className = "session-device-card";
    card.dataset.deviceId = device.id;
    const open = disclosure.isDeviceOpen(device.id, filter);
    card.dataset.collapsed = String(!open);
    const header = document.createElement("button");
    header.type = "button";
    header.className = "session-device-header";
    header.setAttribute("aria-expanded", String(open));
    header.setAttribute("aria-label", `${open ? "折叠" : "展开"}${device.name || "未知设备"}`);
    const identity = document.createElement("div");
    identity.className = "session-device-identity";
    const identityTop = document.createElement("div");
    identityTop.className = "session-device-name-row";
    const name = document.createElement("h3");
    name.textContent = device.name || "未知设备";
    const role = document.createElement("span");
    role.className = "session-device-role";
    role.textContent = deviceRoleLabel(device);
    role.dataset.role = device.kind === "local-codex" ? "local" : "remote";
    identityTop.append(name, role);
    const source = document.createElement("span");
    source.textContent = `${device.location || "远程"} · ${deviceHostLabel(device)}`;
    identity.append(identityTop, source);
    const summary = summarizeSessionDevice(device);
    const stats = document.createElement("div");
    stats.className = "session-device-stats";
    for (const text of [`${summary.projectCount} 目录`, `${summary.sessionCount} 会话`, summary.activeCount ? `${summary.activeCount} 进行中` : "当前无进行中", `最近 ${formatDate(summary.latestAt)}`]) {
      const item = document.createElement("span");
      item.textContent = text;
      stats.append(item);
    }
    const status = document.createElement("span");
    status.className = "session-device-status";
    status.dataset.status = device.status || "unknown";
    status.textContent = device.status === "connected" ? "已连接" : device.status === "error" ? "异常" : "未连接";
    const trailing = document.createElement("div");
    trailing.className = "session-device-trailing";
    const disclosureIcon = document.createElement("span");
    disclosureIcon.className = "session-device-disclosure";
    disclosureIcon.setAttribute("aria-hidden", "true");
    disclosureIcon.textContent = "⌄";
    trailing.append(status, disclosureIcon);
    header.append(identity, stats, trailing);
    header.addEventListener("click", () => { disclosure.setDeviceOpen(device.id, !open); render(); });
    const projects = document.createElement("div");
    projects.className = "session-device-projects";
    projects.classList.toggle("hidden", !open);
    projects.replaceChildren(...device.projects.map((project, projectIndex) => projectCard(device, project, projectIndex)));
    if (device.projects.length === 0) {
      const empty = document.createElement("p");
      empty.className = "session-device-empty";
      empty.textContent = "此设备暂时没有可读取的会话。";
      projects.replaceChildren(empty);
    }
    card.append(header, projects);
    return card;
  }

  function render() {
    const tasks = filterSessions(state.tasks, filter);
    visibleDevices = groupSessionsByDevice(state.devices, tasks);
    list.replaceChildren(...visibleDevices.map(deviceCard));
    list.classList.toggle("hidden", state.taskStatus !== "connected" || tasks.length === 0);
    filterEmpty.classList.toggle("hidden", state.taskStatus !== "connected" || tasks.length > 0);
    const filtering = disclosure.isFiltering(filter);
    clearFilter.classList.toggle("hidden", !filtering);
    for (const button of panel.querySelectorAll("[data-session-disclosure]")) {
      button.disabled = filtering;
      button.title = filtering ? "筛选时会自动展开所有匹配项" : "";
    }
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
    clearFilter.addEventListener("click", () => { search.value = ""; statusFilter.value = "all"; filter.query = ""; filter.status = "all"; render(); search.focus(); });
    for (const button of panel.querySelectorAll("[data-session-disclosure]")) {
      button.addEventListener("click", () => { disclosure.setAll(visibleDevices, button.dataset.sessionDisclosure === "expand"); render(); });
    }
    remoteConversation.bind();
    conversationTabs.bind();
  }

  function openRemoteReference(reference) {
    const task = resolveRemoteTaskReference(state.tasks, reference) || provisionalRemoteTaskReference(reference);
    if (!task) return false;
    conversationTabs.open(task);
    return true;
  }

  function copyRemoteProjectReference(reference) {
    const deviceId = typeof reference?.deviceId === "string" ? reference.deviceId : "";
    const sourceDirectory = typeof reference?.sourceDirectory === "string" ? reference.sourceDirectory : "";
    const device = groupSessionsByDevice(state.devices, state.tasks).find((item) => item.id === deviceId);
    const group = device?.projects.find((item) => item.directory === sourceDirectory);
    if (!device || !group) return false;
    const card = Array.from(list.querySelectorAll(".session-project-card")).find((item) => item.dataset.directory === sourceDirectory);
    const button = card?.querySelector(".session-project-copy") || { disabled: false, textContent: "复制项目" };
    void projectCopy.copy(device, group, button);
    return true;
  }

  return { bind, render, setTaskState, openRemoteReference, copyRemoteProjectReference };
}
