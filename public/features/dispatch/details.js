import { requestJson } from "../../core/transport.js";
import { isLocalTask } from "../../core/tasks.js";

const EDITABLE_STATUSES = new Set(["backlog", "scheduled"]);
const STATUS_LABELS = Object.freeze({ backlog: "待排期", scheduled: "已排期", queued: "排队中", sending: "发送中", sent: "已发送", failed: "异常", cancelled: "已取消", delivery_unknown: "交付结果未知" });

export function localDateTimeValue(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function scheduleRelativeLabel(value, now = new Date()) {
  const milliseconds = new Date(value || "").getTime() - now.getTime();
  if (!Number.isFinite(milliseconds)) return "";
  if (milliseconds <= 0) return "即将进入队列";
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours} 小时后`;
  return `${Math.ceil(hours / 24)} 天后`;
}

export function createDispatchDetails({ state, $, formatDate, showToast, onSaved }) {
  const layer = $('[data-testid="dispatch-detail-layer"]');
  const form = $('[data-testid="dispatch-detail-form"]');
  const notice = $('[data-testid="dispatch-detail-notice"]');
  const meta = $('[data-testid="dispatch-detail-meta"]');
  const error = $('[data-testid="dispatch-detail-error"]');
  const save = $('[data-testid="dispatch-detail-save"]');
  let itemId = null;
  let returnFocus = null;

  function projectTasks(project) {
    return state.tasks.filter((task) => isLocalTask(task) && task.project === project);
  }

  function fillProjects(item) {
    const names = [...new Set(state.tasks.filter(isLocalTask).map((task) => task.project || "未归类"))].sort((left, right) => left.localeCompare(right, "zh-CN"));
    if (!names.includes(item.project)) names.unshift(item.project);
    form.elements.project.replaceChildren(...names.map((name) => new Option(name, name)));
    form.elements.project.value = item.project;
  }

  function fillThreads(project, selectedId, fallbackTitle = "") {
    const tasks = projectTasks(project);
    const options = tasks.map((task) => new Option(task.title, task.id));
    if (selectedId && !tasks.some((task) => task.id === selectedId)) options.unshift(new Option(fallbackTitle || `对话 ${selectedId.slice(0, 8)}`, selectedId));
    form.elements.targetThreadId.replaceChildren(...options);
    form.elements.targetThreadId.value = selectedId && options.some((option) => option.value === selectedId) ? selectedId : options[0]?.value || "";
  }

  function render(item) {
    const editable = EDITABLE_STATUSES.has(item.status);
    form.elements.title.value = item.title || "";
    form.elements.prompt.value = item.prompt || "";
    form.elements.scheduledAt.value = localDateTimeValue(item.scheduledAt);
    fillProjects(item);
    fillThreads(item.project, item.targetThreadId, item.targetThreadTitle);
    for (const field of [form.elements.title, form.elements.prompt, form.elements.project, form.elements.targetThreadId, form.elements.scheduledAt]) field.disabled = !editable;
    save.classList.toggle("hidden", !editable);
    notice.textContent = editable ? "修改发送时间会重新排期；清空时间会放回待排期。" : item.status === "queued" ? "任务已进入队列。移到待排期后才能编辑。" : item.status === "delivery_unknown" ? "控制台在发送期间重启。请先核对目标对话，再明确选择是否重新尝试。" : "当前状态为只读，仍可查看完整任务信息。";
    meta.replaceChildren();
    const metadata = [["状态", STATUS_LABELS[item.status] || item.status], ["目标", `${item.project} → ${item.targetThreadTitle}`], ["尝试次数", String(item.attemptCount || 0)], ["创建", formatDate(item.createdAt)], ["更新", formatDate(item.updatedAt)]];
    if (item.activeAttemptId) metadata.splice(3, 0, ["最近尝试", item.activeAttemptId]);
    for (const [term, value] of metadata) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = term;
      dd.textContent = value;
      meta.append(dt, dd);
    }
    error.textContent = item.lastError || "";
    error.classList.toggle("hidden", !item.lastError);
  }

  function close() {
    if (layer.classList.contains("hidden")) return;
    const focusTarget = returnFocus?.isConnected ? returnFocus : Array.from(document.querySelectorAll('[data-dispatch-action="details"]')).find((button) => button.dataset.dispatchId === itemId);
    layer.classList.add("hidden");
    document.body.classList.remove("dispatch-detail-open");
    itemId = null;
    focusTarget?.focus();
    returnFocus = null;
  }

  function open(item, trigger) {
    itemId = item.id;
    returnFocus = trigger || document.activeElement;
    render(item);
    layer.classList.remove("hidden");
    document.body.classList.add("dispatch-detail-open");
    (EDITABLE_STATUSES.has(item.status) ? form.elements.title : layer.querySelector('[data-dispatch-detail-close][aria-label]')).focus();
  }

  function sync() {
    if (!itemId) return;
    const item = state.dispatches.find((candidate) => candidate.id === itemId);
    if (!item) close();
    else render(item);
  }

  async function submit(event) {
    event.preventDefault();
    const item = state.dispatches.find((candidate) => candidate.id === itemId);
    if (!item || !EDITABLE_STATUSES.has(item.status)) return;
    const data = Object.fromEntries(new FormData(form));
    if (!data.targetThreadId) return showToast("请选择一个可用的目标对话。");
    if (data.scheduledAt) {
      const scheduledAt = new Date(data.scheduledAt);
      if (scheduledAt.getTime() <= Date.now()) return showToast("发送时间必须晚于当前时间。");
      data.scheduledAt = scheduledAt.toISOString();
      data.status = "scheduled";
    } else {
      data.scheduledAt = null;
      data.status = "backlog";
    }
    save.disabled = true;
    try {
      await requestJson(`/api/dispatches/${encodeURIComponent(item.id)}`, { method: "PATCH", body: data });
      await onSaved();
      close();
      showToast("任务修改已保存。");
    } catch (submitError) {
      showToast(submitError.message);
    } finally {
      save.disabled = false;
    }
  }

  function bind() {
    layer.addEventListener("click", (event) => { if (event.target.closest("[data-dispatch-detail-close]")) close(); });
    layer.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } });
    form.elements.project.addEventListener("change", () => fillThreads(form.elements.project.value, ""));
    form.addEventListener("submit", submit);
  }

  return { bind, close, open, sync };
}
