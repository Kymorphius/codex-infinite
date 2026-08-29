import { requestJson } from "../../core/transport.js";

export const DISPATCH_COLUMNS = ["backlog", "scheduled", "queued", "sending", "sent", "failed"];

export function dispatchColumnStatus(status) {
  return status === "cancelled" ? "failed" : status;
}

export function dispatchMetrics(items = []) {
  return {
    count: items.length,
    waitingCount: items.filter((item) => ["scheduled", "queued", "sending"].includes(item.status)).length,
    targetCount: new Set(items.map((item) => item.targetThreadId)).size
  };
}

export function destinationProjectNames(tasks = []) {
  return [...new Set(tasks.map((task) => task.project || "未归类"))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function createDispatchFeature({ state, $, formatDate, showToast }) {
  const panel = $('[data-module-panel="board"]');
  const board = $('[data-testid="dispatch-board"]');
  const form = $('[data-testid="dispatch-form"]');
  const projectSelect = $('[data-testid="dispatch-project"]');
  const threadSelect = $('[data-testid="dispatch-thread"]');

  function updateThreadSelector() {
    const tasks = state.tasks.filter((task) => task.project === projectSelect.value);
    threadSelect.replaceChildren();
    if (!tasks.length) {
      threadSelect.append(new Option(projectSelect.value ? "该项目没有可用对话" : "先选择项目", ""));
      threadSelect.disabled = true;
      return;
    }
    threadSelect.append(new Option(`自动：最近对话 · ${tasks[0].title}`, ""));
    for (const task of tasks) threadSelect.append(new Option(`${formatDate(task.updatedAt)} · ${task.title}`, task.id));
    threadSelect.disabled = false;
  }

  function updateDestinations() {
    const currentProject = projectSelect.value;
    const names = destinationProjectNames(state.tasks);
    projectSelect.replaceChildren(new Option("选择项目", ""), ...names.map((name) => new Option(name, name)));
    if (names.includes(currentProject)) projectSelect.value = currentProject;
    updateThreadSelector();
  }

  function dispatchAction(label, action, item, className = "task-open") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.dataset.dispatchAction = action;
    button.dataset.dispatchId = item.id;
    return button;
  }

  function dispatchCard(item) {
    const card = document.createElement("article");
    card.className = "dispatch-card";
    card.dataset.dispatchId = item.id;
    const title = document.createElement("h4");
    title.textContent = item.title;
    const route = document.createElement("div");
    route.className = "dispatch-route";
    route.textContent = `${item.project} → ${item.targetThreadTitle}`;
    const prompt = document.createElement("p");
    prompt.textContent = item.prompt;
    const meta = document.createElement("div");
    meta.className = "dispatch-meta";
    meta.textContent = item.status === "scheduled" ? `计划 ${formatDate(item.scheduledAt)}` : item.status === "sending" ? `开始 ${formatDate(item.startedAt)}` : `更新 ${formatDate(item.updatedAt)}`;
    card.append(title, route, prompt, meta);
    if (item.lastError) {
      const error = document.createElement("div");
      error.className = "dispatch-error";
      error.textContent = item.lastError;
      card.append(error);
    }
    const actions = document.createElement("div");
    actions.className = "dispatch-actions";
    if (["backlog", "scheduled", "failed", "cancelled"].includes(item.status)) actions.append(dispatchAction("立即排队", "queue", item, "primary-button small-button"));
    if (["queued", "scheduled"].includes(item.status)) actions.append(dispatchAction("移到待排期", "backlog", item));
    if (item.status !== "sending") actions.append(dispatchAction("删除", "delete", item, "quiet-button small-button"));
    card.append(actions);
    return card;
  }

  function render() {
    for (const column of DISPATCH_COLUMNS) {
      const items = state.dispatches.filter((item) => dispatchColumnStatus(item.status) === column);
      $(`[data-dispatch-count="${column}"]`).textContent = String(items.length);
      const list = $(`[data-dispatch-list="${column}"]`);
      list.replaceChildren(...items.map(dispatchCard));
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "column-empty";
        empty.textContent = "暂无任务";
        list.append(empty);
      }
    }
    const metrics = dispatchMetrics(state.dispatches);
    $('[data-testid="dispatch-count"]').textContent = String(metrics.count);
    $('[data-testid="dispatch-waiting-count"]').textContent = String(metrics.waitingCount);
    $('[data-testid="dispatch-target-count"]').textContent = String(metrics.targetCount);
  }

  function setState(status, message = "") {
    state.dispatchStatus = status;
    for (const element of panel.querySelectorAll("[data-dispatch-state]")) element.classList.toggle("hidden", element.dataset.dispatchState !== status);
    const messageElement = panel.querySelector("[data-dispatch-state-message]");
    if (message && messageElement) messageElement.textContent = message;
    board.classList.toggle("hidden", status !== "connected");
  }

  function setTaskState(status, label) {
    const connected = status === "connected";
    $('[data-testid="connection-status"]').textContent = connected ? "目标已连接" : label;
    for (const element of form.elements) element.disabled = !connected;
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) setState("loading");
    try {
      const data = await requestJson("/api/dispatches", { cache: "no-store" });
      state.dispatches = Array.isArray(data.items) ? data.items : [];
      setState("connected");
      render();
    } catch (error) {
      setState("error", error.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    if (data.mode === "schedule" && !data.scheduledAt) return showToast("选择“按时间发送”时必须设置发送时间。");
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
    try {
      await requestJson("/api/dispatches", { method: "POST", body: data });
      form.reset();
      updateDestinations();
      await load({ quiet: true });
      showToast("任务已加入看板。");
    } catch (error) {
      showToast(error.message);
    }
  }

  async function handleClick(event) {
    const button = event.target.closest("[data-dispatch-action]");
    if (button) {
      button.disabled = true;
      try {
        const path = `/api/dispatches/${encodeURIComponent(button.dataset.dispatchId)}`;
        if (button.dataset.dispatchAction === "delete") await requestJson(path, { method: "DELETE" });
        else await requestJson(path, { method: "PATCH", body: { status: button.dataset.dispatchAction === "queue" ? "queued" : "backlog" } });
        await load({ quiet: true });
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.closest('[data-action="refresh-dispatches"]')) await load();
  }

  function bind() {
    projectSelect.addEventListener("change", updateThreadSelector);
    form.addEventListener("submit", submit);
    panel.addEventListener("click", handleClick);
  }

  return { bind, load, render, setTaskState, updateDestinations };
}
