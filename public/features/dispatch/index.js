import { requestJson } from "../../core/transport.js";
import { isLocalTask } from "../../core/tasks.js";
import { createDispatchDetails, scheduleRelativeLabel } from "./details.js";
import { createPersonalPanelBoard } from './personal-panel.js';

export const DISPATCH_COLUMNS = ["backlog", "scheduled", "queued", "sending", "sent", "failed"];

export function dispatchColumnStatus(status) {
  return ["cancelled", "delivery_unknown"].includes(status) ? "failed" : status;
}

export function orderDispatchColumn(items = [], status) {
  if (status !== "queued") return items;
  return [...items].sort((left, right) => (Number(left.queueOrder) || Number.MAX_SAFE_INTEGER) - (Number(right.queueOrder) || Number.MAX_SAFE_INTEGER));
}

export function dispatchMetrics(items = []) {
  return {
    count: items.length,
    waitingCount: items.filter((item) => ["scheduled", "queued", "sending"].includes(item.status)).length,
    targetCount: new Set(items.map((item) => item.targetThreadId || item.createdThreadId).filter(Boolean)).size
  };
}

export function destinationProjectNames(tasks = []) {
  return [...new Set(tasks.map((task) => task.project || "未归类"))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function filterDispatches(items = [], { query = "", project = "" } = {}) {
  const needle = String(query).trim().toLocaleLowerCase("zh-CN");
  return items.filter((item) => {
    if (project && item.project !== project) return false;
    if (!needle) return true;
    return [item.title, item.prompt, item.project, item.targetThreadTitle, item.lastError]
      .some((value) => String(value || "").toLocaleLowerCase("zh-CN").includes(needle));
  });
}

export function checklistBoardStatus(item) {
  return item.done ? 'done' : item.assignedThreadId ? 'assigned' : 'unassigned';
}

export function createDispatchFeature({ state, $, formatDate, showToast, requestOpen }) {
  const panel = $('[data-module-panel="board"]');
  const board = $('[data-testid="dispatch-board"]');
  const form = $('[data-testid="dispatch-form"]');
  const projectSelect = $('[data-testid="dispatch-project"]');
  const threadSelect = $('[data-testid="dispatch-thread"]');
  const search = $('[data-testid="dispatch-search"]');
  const projectFilter = $('[data-testid="dispatch-filter-project"]');
  const clearFilter = $('[data-testid="dispatch-clear-filter"]');
  const composer = $('[data-testid="dispatch-composer"]');
  const results = $('[data-testid="dispatch-results"]');
  const filter = { query: "", project: "" };
  let checklistSignature = '';
  const details = createDispatchDetails({ state, $, formatDate, showToast, onSaved: () => load({ quiet: true }) });
  const personalPanel = createPersonalPanelBoard({ $, showToast, formatDate });

  function updateThreadSelector() {
    const tasks = state.tasks.filter((task) => isLocalTask(task) && task.project === projectSelect.value);
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
    const names = destinationProjectNames(state.tasks.filter(isLocalTask));
    projectSelect.replaceChildren(new Option("选择项目", ""), ...names.map((name) => new Option(name, name)));
    if (names.includes(currentProject)) projectSelect.value = currentProject;
    updateThreadSelector();
  }

  function updateProjectFilter() {
    const currentProject = projectFilter.value;
    const names = destinationProjectNames(state.dispatches);
    projectFilter.replaceChildren(new Option("全部项目", ""), ...names.map((name) => new Option(name, name)));
    if (names.includes(currentProject)) projectFilter.value = currentProject;
    else filter.project = "";
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
    route.textContent = `${item.project} → ${item.actionType === "new_thread" ? (item.createdThreadId ? "已新建会话" : "新建会话") : item.targetThreadTitle}`;
    const prompt = document.createElement("p");
    prompt.textContent = item.prompt;
    const meta = document.createElement("div");
    meta.className = "dispatch-meta";
    meta.textContent = item.status === "queued" ? `发送顺序 ${item.queueOrder || "—"}` : item.status === "backlog" ? "仅保留为待办，不会自动发送" : item.status === "scheduled" ? `计划 ${formatDate(item.scheduledAt)} · ${scheduleRelativeLabel(item.scheduledAt)}` : item.status === "sending" ? `开始 ${formatDate(item.startedAt)}` : `更新 ${formatDate(item.updatedAt)}`;
    card.append(title, route, prompt, meta);
    if (item.generatorName) {
      const source = document.createElement("div");
      source.className = "dispatch-source";
      source.textContent = `来自发生器：${item.generatorName}`;
      card.append(source);
    }
    if (item.lastError) {
      const error = document.createElement("div");
      error.className = "dispatch-error";
      error.textContent = item.lastError;
      card.append(error);
    }
    const actions = document.createElement("div");
    actions.className = "dispatch-actions";
    actions.append(dispatchAction(["backlog", "scheduled"].includes(item.status) ? "编辑" : "查看详情", "details", item));
    if (["backlog", "scheduled", "failed", "cancelled", "delivery_unknown"].includes(item.status)) actions.append(dispatchAction(["failed", "cancelled", "delivery_unknown"].includes(item.status) ? "重新尝试" : "加入发送队列", "queue", item, "primary-button small-button"));
    if (item.status === "queued") {
      const queued = orderDispatchColumn(state.dispatches.filter((candidate) => candidate.status === "queued"), "queued");
      const index = queued.findIndex((candidate) => candidate.id === item.id);
      const up = dispatchAction("上移", "queue-up", item);
      const down = dispatchAction("下移", "queue-down", item);
      up.setAttribute("aria-label", `${item.title}：在发送队列中上移`);
      down.setAttribute("aria-label", `${item.title}：在发送队列中下移`);
      up.disabled = index <= 0;
      down.disabled = index < 0 || index >= queued.length - 1;
      actions.append(up, down);
    }
    if (["queued", "scheduled"].includes(item.status)) actions.append(dispatchAction("仅保留待办", "backlog", item));
    if (item.status !== "sending") actions.append(dispatchAction("删除", "delete", item, "quiet-button small-button"));
    card.append(actions);
    return card;
  }

  function render() {
    const checklistError = $('[data-testid="checklist-board-error"]');
    checklistError.textContent = state.checklistError || '';
    checklistError.classList.toggle('hidden', !state.checklistError);
    const nextChecklistSignature = JSON.stringify(state.checklistItems || []);
    if (nextChecklistSignature !== checklistSignature) {
      checklistSignature = nextChecklistSignature;
      for (const status of ['unassigned', 'assigned', 'done']) {
        const items = (state.checklistItems || []).filter(item => checklistBoardStatus(item) === status);
        $(`[data-checklist-count="${status}"]`).textContent = String(items.length);
        const list = $(`[data-checklist-list="${status}"]`);
        list.replaceChildren(...items.map(item => {
          const card = document.createElement('article'); card.className = 'dispatch-card'; card.dataset.checklistId = item.id;
          const text = document.createElement('p'); text.textContent = item.text;
          const meta = document.createElement('div'); meta.className = 'dispatch-meta';
          meta.textContent = [item.createdAt ? formatDate(item.createdAt) : '', status === 'assigned' ? `已领取·暂停 · 会话 ${item.assignedThreadId.slice(0, 8)}` : status === 'done' ? '已完成' : '下一步：领取或指派'].filter(Boolean).join(' · ');
          const actions = document.createElement('div'); actions.className = 'dispatch-actions';
          const manage = document.createElement('button'); manage.type = 'button'; manage.className = 'task-open';
          manage.textContent = status === 'done' ? '回看任务' : '处理任务';
          manage.dataset.checklistAction = 'manage'; manage.dataset.checklistId = item.id; actions.append(manage);
          if (status === 'assigned') {
            const visit = document.createElement('button'); visit.type = 'button'; visit.className = 'primary-button small-button';
            visit.textContent = '去会话'; visit.dataset.checklistAction = 'conversation'; visit.dataset.checklistId = item.id; actions.append(visit);
          }
          card.append(text, meta, actions); return card;
        }));
        if (!items.length) { const empty = document.createElement('div'); empty.className = 'column-empty'; empty.textContent = '暂无任务'; list.append(empty); }
      }
    }
    updateProjectFilter();
    const visibleItems = filterDispatches(state.dispatches, filter);
    for (const column of DISPATCH_COLUMNS) {
      const items = orderDispatchColumn(visibleItems.filter((item) => dispatchColumnStatus(item.status) === column), column);
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
    const resultCount = visibleItems.filter((item) => ["sent", "failed", "cancelled", "delivery_unknown"].includes(item.status)).length;
    $('[data-testid="dispatch-result-count"]').textContent = filter.query || filter.project ? `${visibleItems.length} / ${state.dispatches.length} 条任务` : `${state.dispatches.length} 条任务`;
    $('[data-testid="dispatch-results-summary"]').textContent = `${resultCount} 条记录`;
    clearFilter.classList.toggle("hidden", !filter.query && !filter.project);
    results.classList.toggle("hidden", state.dispatchStatus !== "connected");
    details.sync();
  }

  function setComposerOpen(open) {
    composer.classList.toggle("hidden", !open);
    for (const button of panel.querySelectorAll('[data-action="toggle-dispatch-composer"]')) button.setAttribute("aria-expanded", String(open));
    if (open) form.elements.title.focus();
  }

  function setState(status, message = "") {
    state.dispatchStatus = status;
    for (const element of panel.querySelectorAll("[data-dispatch-state]")) element.classList.toggle("hidden", element.dataset.dispatchState !== status);
    const messageElement = panel.querySelector("[data-dispatch-state-message]");
    if (message && messageElement) messageElement.textContent = message;
    board.classList.toggle("hidden", status !== "connected");
    results.classList.toggle("hidden", status !== "connected");
  }

  function setTaskState(status, label) {
    const connected = status === "connected";
    $('[data-testid="connection-status"]').textContent = connected ? "目标已连接" : label;
    for (const element of form.elements) element.disabled = !connected;
    panel.querySelector(".dispatch-create-toggle").disabled = !connected;
  }

  async function load({ quiet = false } = {}) {
    if (state.module === 'board') void personalPanel.load();
    if (!quiet) setState("loading");
    try {
      const data = await requestJson("/api/dispatches", { cache: "no-store" });
      state.dispatches = Array.isArray(data.items) ? data.items : [];
      if (!data.checklistError) state.checklistItems = Array.isArray(data.checklistItems) ? data.checklistItems : [];
      state.checklistError = data.checklistError || null;
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
    const checklistAction = event.target.closest('[data-checklist-action]');
    if (checklistAction) {
      const item = state.checklistItems.find(candidate => candidate.id === checklistAction.dataset.checklistId);
      if (!item) return showToast('任务状态已变化，请刷新后重试。');
      if (checklistAction.dataset.checklistAction === 'conversation') {
        if (!item.assignedThreadId || item.done) return showToast('这项任务当前没有待处理会话。');
        const thread = state.tasks.find(task => isLocalTask(task) && task.id === item.assignedThreadId);
        if (!thread) return showToast('所属会话暂时不可用，请从原任务清单处理。');
        requestOpen(thread);
      } else if (checklistAction.dataset.checklistAction === 'manage') {
        if (window.parent === window) return showToast('请在 Codex 控制台中打开原任务清单。');
        window.parent.postMessage({ type: 'codex-control-console-open-checklist-task', taskId: item.id }, '*');
      }
      return;
    }
    const button = event.target.closest("[data-dispatch-action]");
    if (button) {
      if (button.dataset.dispatchAction === "details") {
        const item = state.dispatches.find((candidate) => candidate.id === button.dataset.dispatchId);
        if (item) details.open(item, button);
        return;
      }
      button.disabled = true;
      try {
        const path = `/api/dispatches/${encodeURIComponent(button.dataset.dispatchId)}`;
        if (button.dataset.dispatchAction === "delete") await requestJson(path, { method: "DELETE" });
        else if (["queue-up", "queue-down"].includes(button.dataset.dispatchAction)) await requestJson(`${path}/queue-order`, { method: "PATCH", body: { direction: button.dataset.dispatchAction === "queue-up" ? "up" : "down" } });
        else await requestJson(path, { method: "PATCH", body: { status: button.dataset.dispatchAction === "queue" ? "queued" : "backlog" } });
        await load({ quiet: true });
      } catch (error) {
        showToast(error.message);
        button.disabled = false;
      }
      return;
    }
    if (event.target.closest('[data-action="refresh-dispatches"]')) await load();
    const composerToggle = event.target.closest('[data-action="toggle-dispatch-composer"]');
    if (composerToggle) setComposerOpen(composer.classList.contains("hidden"));
  }

  function bind() {
    projectSelect.addEventListener("change", updateThreadSelector);
    search.addEventListener("input", () => { filter.query = search.value.trim().slice(0, 200); render(); });
    projectFilter.addEventListener("change", () => { filter.project = projectFilter.value; render(); });
    clearFilter.addEventListener("click", () => { search.value = ""; projectFilter.value = ""; filter.query = ""; filter.project = ""; render(); search.focus(); });
    form.addEventListener("submit", submit);
    panel.addEventListener("click", handleClick);
    details.bind();
  }

  return { bind, load, render, setTaskState, updateDestinations };
}
