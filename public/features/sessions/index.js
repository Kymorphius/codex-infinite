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

export function createSessionsFeature({ state, $, formatDate, statusLabel, requestOpen, fetchImpl = fetch }) {
  const panel = $('[data-module-panel="sessions"]');
  const list = $('[data-testid="session-project-list"]');
  const search = $('[data-testid="session-search"]');
  const statusFilter = $('[data-testid="session-status-filter"]');
  const filterEmpty = $('[data-testid="session-filter-empty"]');
  const activityLayer = $('[data-testid="session-activity-layer"]');
  const activityList = $('[data-testid="session-activity-list"]');
  const activityState = $('[data-testid="session-activity-state"]');
  const remoteComposer = $('[data-testid="session-remote-composer"]');
  const remotePrompt = $('[data-testid="session-remote-prompt"]');
  const remoteSend = $('[data-testid="session-remote-send"]');
  const remoteSendStatus = $('[data-testid="session-remote-send-status"]');
  const filter = { query: "", status: "all" };
  let selectedActivityTask = null;
  let activityLoading = false;
  let messageSending = false;
  let remoteDraftRevision = null;
  let syncedDraftText = "";

  function activityEntry(entry) {
    const item = document.createElement("article");
    item.className = "session-activity-entry";
    item.dataset.kind = entry.kind;
    if (entry.kind === "message") {
      item.dataset.role = entry.role;
      const label = document.createElement("span");
      label.textContent = entry.role === "user" ? "你" : entry.phase === "commentary" ? "Codex · 过程" : "Codex";
      const text = document.createElement("p");
      text.textContent = entry.text;
      item.append(label, text);
    } else {
      const label = document.createElement("span");
      label.textContent = entry.kind === "tool" ? "执行" : "状态";
      const text = document.createElement("p");
      text.textContent = entry.kind === "tool" ? `${entry.name || "工具"} · ${entry.status || "已请求"}` : entry.status === "completed" ? "本轮已完成" : "本轮已开始";
      item.append(label, text);
    }
    if (entry.timestamp) {
      const time = document.createElement("time");
      time.textContent = formatDate(entry.timestamp);
      item.append(time);
    }
    return item;
  }

  async function loadActivity({ quiet = false } = {}) {
    if (!selectedActivityTask || activityLoading) return;
    activityLoading = true;
    const task = selectedActivityTask;
    if (!quiet) {
      activityState.textContent = "正在读取所属节点…";
      activityState.classList.remove("hidden");
      activityList.classList.add("hidden");
    }
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/activity?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedActivityTask !== task) return;
      const entries = Array.isArray(result.activity?.entries) ? result.activity.entries : [];
      const draft = result.activity?.draft;
      if (draft?.text && draft.revision && (!remotePrompt.value.trim() || remotePrompt.value === syncedDraftText)) {
        remotePrompt.value = draft.text;
        syncedDraftText = draft.text;
        remoteDraftRevision = draft.revision;
        if (!messageSending) {
          remoteSendStatus.dataset.status = "accepted";
          remoteSendStatus.textContent = `已读取 ${task.device?.name || "所属节点"} 的原生未发送草稿。`;
        }
      } else if (!draft && remotePrompt.value === syncedDraftText) {
        remotePrompt.value = "";
        syncedDraftText = "";
        remoteDraftRevision = null;
      }
      activityList.replaceChildren(...entries.map(activityEntry));
      activityList.classList.toggle("hidden", entries.length === 0);
      activityState.classList.toggle("hidden", entries.length > 0);
      activityState.textContent = entries.length ? "" : "这个会话最近没有可显示的活动。";
      $('[data-testid="session-activity-updated"]').textContent = `更新 ${formatDate(result.activity?.updatedAt || new Date().toISOString())}`;
      activityList.scrollTop = activityList.scrollHeight;
    } catch (error) {
      if (selectedActivityTask !== task) return;
      activityState.textContent = `暂时无法读取：${error.message}`;
      activityState.classList.remove("hidden");
      if (!quiet) activityList.classList.add("hidden");
    } finally {
      activityLoading = false;
    }
  }

  function openActivity(task) {
    selectedActivityTask = task;
    $('[data-testid="session-activity-title"]').textContent = task.title;
    $('[data-testid="session-activity-directory"]').textContent = task.cwd || "未记录远端工作目录";
    $('[data-testid="session-activity-owner"]').textContent = `${task.device?.name || "远端节点"} · 原生 Codex · 可交互`;
    remotePrompt.placeholder = `发送到 ${task.device?.name || "所属节点"} 的 Codex…`;
    remotePrompt.value = "";
    syncedDraftText = "";
    remoteDraftRevision = null;
    remoteSendStatus.textContent = "";
    activityLayer.classList.remove("hidden");
    void loadActivity();
  }

  function closeActivity() {
    selectedActivityTask = null;
    activityLayer.classList.add("hidden");
  }

  async function sendRemoteMessage() {
    const task = selectedActivityTask;
    const prompt = remotePrompt.value.trim();
    if (!task || !prompt || messageSending) return;
    messageSending = true;
    remoteSend.disabled = true;
    remotePrompt.disabled = true;
    remoteSendStatus.dataset.status = "sending";
    remoteSendStatus.textContent = `正在交给 ${task.device?.name || "所属节点"}…`;
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/messages?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, expectedDraftRevision: remoteDraftRevision }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (selectedActivityTask !== task) return;
      remotePrompt.value = "";
      syncedDraftText = "";
      remoteDraftRevision = null;
      remoteSendStatus.dataset.status = "accepted";
      remoteSendStatus.textContent = result.duplicate ? "所属节点已接收过这条消息，正在继续同步。" : `${task.device?.name || "所属节点"} 已接收，等待 Codex 响应…`;
      setTimeout(() => void loadActivity({ quiet: true }), 1000);
    } catch (error) {
      if (selectedActivityTask !== task) return;
      remoteSendStatus.dataset.status = "error";
      remoteSendStatus.textContent = `发送失败：${error.message}`;
      await loadActivity({ quiet: true });
    } finally {
      messageSending = false;
      remoteSend.disabled = false;
      remotePrompt.disabled = false;
      remotePrompt.focus();
    }
  }

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
    open.addEventListener("click", () => local ? requestOpen(task) : openActivity(task));
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

  function deviceCard(device) {
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
    projects.replaceChildren(...device.projects.map((project, projectIndex) => projectCard(project, projectIndex)));
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
    for (const close of activityLayer.querySelectorAll("[data-session-activity-close]")) close.addEventListener("click", closeActivity);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && selectedActivityTask) closeActivity(); });
    remoteComposer.addEventListener("submit", (event) => { event.preventDefault(); void sendRemoteMessage(); });
    remotePrompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); remoteComposer.requestSubmit(); }
    });
    setInterval(() => { if (selectedActivityTask) void loadActivity({ quiet: true }); }, 3000);
  }

  return { bind, render, setTaskState };
}
