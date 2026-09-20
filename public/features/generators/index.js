import { requestJson } from "../../core/transport.js";
import { isLocalTask } from "../../core/tasks.js";

export function generatorMetrics(generators = [], runs = []) {
  return {
    count: generators.length,
    pendingCount: generators.filter((item) => item.scheduleState === "pending").length,
    runCount: runs.length
  };
}

export function generatorRunLabel(status) {
  return { materializing: "准备队列", queued: "排队中", running: "执行中", completed: "已完成", failed: "有异常" }[status] || "状态未知";
}

export function createGeneratorsFeature({ state, $, formatDate, showToast }) {
  const panel = $('[data-module-panel="generators"]');
  const composer = $('[data-testid="generator-composer"]');
  const form = $('[data-testid="generator-form"]');
  const editor = $('[data-testid="generator-task-editor"]');
  const list = $('[data-testid="generator-list"]');
  const runsSection = $('[data-testid="generator-runs"]');
  const runList = $('[data-testid="generator-run-list"]');

  function localProjectNames() {
    return [...new Set(state.tasks.filter(isLocalTask).filter((task) => task.cwd).map((task) => task.project).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
  }

  function projectTasks(project) {
    return state.tasks.filter((task) => isLocalTask(task) && task.cwd && task.project === project);
  }

  function updateTaskNumbers() {
    [...editor.children].forEach((row, index) => { row.querySelector(".generator-task-order").textContent = String(index + 1); });
  }

  function updateRow(row) {
    const action = row.querySelector('[name="action"]');
    const project = row.querySelector('[name="project"]');
    const threadField = row.querySelector(".generator-thread");
    const thread = row.querySelector('[name="targetThreadId"]');
    const previousProject = project.value;
    const names = localProjectNames();
    project.replaceChildren(new Option("选择项目", ""), ...names.map((name) => new Option(name, name)));
    if (names.includes(previousProject)) project.value = previousProject;
    const previousThread = thread.value;
    const tasks = projectTasks(project.value);
    thread.replaceChildren(new Option(tasks.length ? `自动：最近对话 · ${tasks[0].title}` : "先选择项目", ""), ...tasks.map((task) => new Option(task.title, task.id)));
    if (tasks.some((task) => task.id === previousThread)) thread.value = previousThread;
    const creates = action.value === "new_thread";
    threadField.classList.toggle("hidden", creates);
    thread.disabled = creates;
  }

  function addTask(values = {}) {
    const row = document.createElement("fieldset");
    row.className = "generator-task-row";
    row.innerHTML = `<div class="generator-task-order" aria-label="任务顺序"></div>
      <label class="field"><span>动作</span><select name="action"><option value="existing_thread">发送到已有对话</option><option value="new_thread">新建会话并发送</option></select></label>
      <label class="field"><span>项目</span><select name="project" required></select></label>
      <label class="field generator-thread"><span>目标对话</span><select name="targetThreadId"></select></label>
      <button class="quiet-button generator-remove-task" type="button" data-action="remove-generator-task">移除</button>
      <label class="field generator-task-title"><span>任务标题</span><input name="title" maxlength="160" required placeholder="用于运行记录"></label>
      <label class="field generator-task-prompt"><span>发送给 Codex 的消息</span><textarea name="prompt" maxlength="12000" rows="3" required placeholder="写清目标、范围和验收条件"></textarea></label>`;
    row.querySelector('[name="action"]').value = values.action || "existing_thread";
    row.querySelector('[name="title"]').value = values.title || "";
    row.querySelector('[name="prompt"]').value = values.prompt || "";
    editor.append(row);
    updateRow(row);
    if (values.project) { row.querySelector('[name="project"]').value = values.project; updateRow(row); }
    if (values.targetThreadId) row.querySelector('[name="targetThreadId"]').value = values.targetThreadId;
    updateTaskNumbers();
    return row;
  }

  function setComposerOpen(open) {
    composer.classList.toggle("hidden", !open);
    for (const button of panel.querySelectorAll('[data-action="toggle-generator-composer"]')) button.setAttribute("aria-expanded", String(open));
    if (open) {
      if (!editor.children.length) addTask();
      form.elements.name.focus();
    }
  }

  function setState(status, message = "") {
    for (const element of panel.querySelectorAll("[data-generator-state]")) element.classList.toggle("hidden", element.dataset.generatorState !== status);
    const target = panel.querySelector("[data-generator-state-message]");
    if (message && target) target.textContent = message;
  }

  function renderGenerator(item) {
    const card = document.createElement("article");
    card.className = "generator-card";
    const copy = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.name;
    const meta = document.createElement("div");
    meta.className = "generator-card-meta";
    meta.textContent = item.scheduledAt
      ? item.scheduleState === "pending" ? `定时触发：${formatDate(item.scheduledAt)}` : `定时触发已于 ${formatDate(item.scheduledAt)} 执行`
      : "仅手动触发";
    copy.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "generator-card-actions";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "primary-button";
    trigger.textContent = "立即触发";
    trigger.dataset.generatorAction = "trigger";
    trigger.dataset.generatorId = item.id;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "quiet-button";
    remove.textContent = "删除";
    remove.dataset.generatorAction = "delete";
    remove.dataset.generatorId = item.id;
    actions.append(trigger, remove);
    const summary = document.createElement("div");
    summary.className = "generator-task-summary";
    for (const [index, task] of item.tasks.entries()) {
      const chip = document.createElement("span");
      chip.className = "generator-task-chip";
      chip.textContent = `${index + 1}. ${task.action === "new_thread" ? "新会话" : task.targetThreadTitle} · ${task.title}`;
      summary.append(chip);
    }
    card.append(copy, actions, summary);
    return card;
  }

  function renderRun(run) {
    const row = document.createElement("article");
    row.className = "generator-run";
    const title = document.createElement("strong");
    title.textContent = run.generatorName;
    const meta = document.createElement("span");
    meta.className = "generator-run-meta";
    meta.textContent = `${run.source === "scheduled" ? "定时触发" : "手动触发"} · ${formatDate(run.triggeredAt)} · ${run.taskCount} 个任务`;
    const status = document.createElement("span");
    status.className = "generator-run-status";
    status.dataset.status = run.status;
    status.textContent = generatorRunLabel(run.status);
    row.append(title, meta, status);
    return row;
  }

  function render() {
    const generators = state.generators || [];
    const runs = state.generatorRuns || [];
    const metrics = generatorMetrics(generators, runs);
    $('[data-testid="generator-count"]').textContent = String(metrics.count);
    $('[data-testid="generator-pending-count"]').textContent = String(metrics.pendingCount);
    $('[data-testid="generator-run-count"]').textContent = String(metrics.runCount);
    list.replaceChildren(...generators.map(renderGenerator));
    runList.replaceChildren(...runs.slice(0, 30).map(renderRun));
    setState(generators.length ? "connected" : "empty");
    runsSection.classList.toggle("hidden", !runs.length);
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) setState("loading");
    try {
      const data = await requestJson("/api/generators", { cache: "no-store" });
      state.generators = Array.isArray(data.generators) ? data.generators : [];
      state.generatorRuns = Array.isArray(data.runs) ? data.runs : [];
      render();
    } catch (error) {
      setState("error", error.message);
    }
  }

  function serializeTasks() {
    return [...editor.children].map((row) => ({
      action: row.querySelector('[name="action"]').value,
      project: row.querySelector('[name="project"]').value,
      targetThreadId: row.querySelector('[name="targetThreadId"]').value,
      title: row.querySelector('[name="title"]').value,
      prompt: row.querySelector('[name="prompt"]').value
    }));
  }

  async function submit(event) {
    event.preventDefault();
    const scheduledAt = form.elements.scheduledAt.value;
    const body = { name: form.elements.name.value, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null, tasks: serializeTasks() };
    try {
      await requestJson("/api/generators", { method: "POST", body });
      form.reset();
      editor.replaceChildren();
      setComposerOpen(false);
      await load({ quiet: true });
      showToast("发生器已保存，尚未触发。");
    } catch (error) { showToast(error.message); }
  }

  async function handleGeneratorAction(button) {
    if (button.dataset.generatorAction === "delete" && !confirm("删除这个发生器？已有运行记录和发送任务会保留。")) return;
    button.disabled = true;
    try {
      const id = encodeURIComponent(button.dataset.generatorId);
      if (button.dataset.generatorAction === "delete") {
        await requestJson(`/api/generators/${id}`, { method: "DELETE" });
      } else {
        button.dataset.requestId ||= crypto.randomUUID();
        await requestJson(`/api/generators/${id}/trigger`, { method: "POST", body: { requestId: button.dataset.requestId } });
        delete button.dataset.requestId;
        showToast("发生器已触发，任务正在进入发送队列。");
      }
      await load({ quiet: true });
    } catch (error) { showToast(error.message); button.disabled = false; }
  }

  function bind() {
    form.addEventListener("submit", submit);
    editor.addEventListener("change", (event) => {
      if (event.target.matches('[name="action"], [name="project"]')) updateRow(event.target.closest(".generator-task-row"));
    });
    panel.addEventListener("click", (event) => {
      const generatorAction = event.target.closest("[data-generator-action]");
      if (generatorAction) return void handleGeneratorAction(generatorAction);
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action === "toggle-generator-composer") setComposerOpen(composer.classList.contains("hidden"));
      if (action === "add-generator-task") addTask();
      if (action === "remove-generator-task") {
        if (editor.children.length === 1) return showToast("发生器至少需要一个任务。");
        event.target.closest(".generator-task-row").remove();
        updateTaskNumbers();
      }
      if (action === "refresh-generators") void load();
    });
  }

  function updateDestinations() {
    for (const row of editor.children) updateRow(row);
  }

  function setTaskState(status) {
    const disabled = status !== "connected";
    panel.querySelector('[data-action="toggle-generator-composer"]').disabled = disabled;
    for (const element of form.elements) element.disabled = disabled;
    if (!disabled) updateDestinations();
  }

  return { bind, load, render, setTaskState, updateDestinations };
}
