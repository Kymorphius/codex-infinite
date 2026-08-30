import { isLocalTask } from "../../core/tasks.js";

export function consoleMetrics(tasks = [], connected = true) {
  return {
    count: connected ? String(tasks.length) : "—",
    source: connected ? "节点记录" : "不可用"
  };
}

export function createConsoleFeature({ state, $, formatDate, statusLabel, requestOpen }) {
  const panel = $('[data-module-panel="console"]');
  const list = $('[data-testid="console-task-list"]');

  function taskCard(task) {
    const card = document.createElement("article");
    card.className = "task-card";
    card.dataset.taskId = task.id;
    const main = document.createElement("div");
    main.className = "task-card-main";
    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;
    const meta = document.createElement("div");
    meta.className = "task-meta";
    for (const text of [statusLabel(task), task.project || "未归类", `更新 ${formatDate(task.updatedAt)}`]) {
      const span = document.createElement("span");
      span.textContent = text;
      meta.append(span);
    }
    main.append(title, meta);
    const open = document.createElement("button");
    open.type = "button";
    open.className = "task-open";
    const local = isLocalTask(task);
    open.textContent = local ? "在 Codex 中打开" : "由远端节点打开";
    open.disabled = !local;
    if (local) open.addEventListener("click", () => requestOpen(task));
    card.append(main, open);
    return card;
  }

  function render() {
    list.replaceChildren(...state.tasks.map(taskCard));
  }

  function setTaskState(responseStatus, label, message = "") {
    for (const element of panel.querySelectorAll("[data-console-state]")) element.classList.toggle("hidden", element.getAttribute("data-console-state") !== responseStatus);
    for (const element of panel.querySelectorAll("[data-console-state-message]")) if (message) element.textContent = message;
    const connected = responseStatus === "connected";
    const metrics = consoleMetrics(state.tasks, connected);
    $('[data-testid="console-task-count"]').textContent = metrics.count;
    $('[data-testid="console-task-source"]').textContent = responseStatus === "loading" ? "读取中" : metrics.source;
    $('[data-testid="console-connection-status"]').textContent = label;
    list.classList.toggle("hidden", !connected);
  }

  return { render, setTaskState };
}
