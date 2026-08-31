import { presentSessionSettings } from "./model.js";

const ACCESS_OPTIONS = Object.freeze({
  "read-only": Object.freeze({ label: "只读", description: "只能查看文件和会话内容" }),
  workspace: Object.freeze({ label: "工作区访问", description: "可修改当前项目工作区" }),
  "full-access": Object.freeze({ label: "完全访问", description: "允许在这台设备上完整执行" })
});

const SPEED_OPTIONS = Object.freeze({
  default: Object.freeze({ label: "标准", description: "默认推理速度" }),
  priority: Object.freeze({ label: "快速", description: "约 1.5× 速度，会增加用量" }),
  ultrafast: Object.freeze({ label: "极速", description: "适合对延迟敏感的任务" })
});

export function mergeSessionSettings(task = {}, activity = null) {
  const activityAccess = activity?.accessMode && activity.accessMode !== "unknown";
  const activityContext = activity?.contextOverrideState && activity.contextOverrideState !== "unknown";
  return Object.freeze({
    model: activity?.model || task.model || null,
    reasoningEffort: activity?.reasoningEffort || task.reasoningEffort || null,
    serviceTier: activity?.serviceTier || task.serviceTier || null,
    approvalPolicy: activity?.approvalPolicy || task.approvalPolicy || null,
    permissionProfile: activity?.permissionProfile || task.permissionProfile || null,
    accessMode: activityAccess ? activity.accessMode : task.accessMode || "unknown",
    contextOverrideState: activityContext ? activity.contextOverrideState : task.contextOverrideState || "unknown",
    requestedContextWindow: activityContext ? activity.requestedContextWindow : task.requestedContextWindow || null,
    modelContextWindow: activity?.modelContextWindow || task.modelContextWindow || null
  });
}

export function settingsMenuOptions(key, current = {}, options = null) {
  if (!options || typeof options !== "object") return Object.freeze([]);
  if (key === "model") return Object.freeze((options.models || []).map((model) => Object.freeze({
    value: model.id,
    label: model.displayName || model.id,
    description: model.description || model.id,
    selected: model.id === current.model
  })));
  if (key === "reasoning") {
    const model = (options.models || []).find((item) => item.id === current.model);
    return Object.freeze((model?.reasoningEfforts || []).map((item) => Object.freeze({
      value: item.effort,
      label: item.effort,
      description: item.description || null,
      selected: item.effort === current.reasoningEffort
    })));
  }
  if (key === "speed") {
    const model = (options.models || []).find((item) => item.id === current.model);
    return Object.freeze((model?.serviceTiers || []).flatMap((item) => {
      const presentation = SPEED_OPTIONS[item.id];
      return presentation ? [Object.freeze({
        value: item.id,
        label: presentation.label,
        description: item.description || presentation.description,
        selected: item.id === current.serviceTier
      })] : [];
    }));
  }
  if (key === "access") return Object.freeze((options.accessModes || []).flatMap((value) => {
    const item = ACCESS_OPTIONS[value];
    return item ? [Object.freeze({ value, ...item, selected: value === current.accessMode })] : [];
  }));
  if (key === "context" && Number.isSafeInteger(options.contextWindow)) return Object.freeze([
    Object.freeze({ value: "default", label: "模型默认", description: "关闭此会话的百万上下文", selected: current.contextOverrideState === "default" }),
    Object.freeze({ value: "extended", label: "百万上下文", description: `${options.contextWindow.toLocaleString("en-US")} tokens，仅当前会话`, selected: current.contextOverrideState === "extended" })
  ]);
  return Object.freeze([]);
}

export function settingsSavedLabel(activeTurnPreserved) {
  return activeTurnPreserved ? "已保存，下轮生效" : "已保存，将用于下一轮";
}

function changeFor(key, value) {
  if (key === "model") return { model: value };
  if (key === "reasoning") return { reasoningEffort: value };
  if (key === "speed") return { serviceTier: value };
  if (key === "access") return { accessMode: value };
  if (key === "context") return { contextOverrideState: value };
  return null;
}

function createMenu(key, choices, onSelect, onDismiss) {
  const menu = document.createElement("div");
  menu.className = "conversation-settings-menu";
  menu.dataset.settingMenu = key;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${key} 选项`);
  for (const choice of choices) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "conversation-settings-menu-option";
    option.dataset.value = choice.value;
    option.setAttribute("role", "menuitemradio");
    option.setAttribute("aria-checked", String(choice.selected));
    const check = document.createElement("span");
    check.className = "conversation-settings-menu-check";
    check.textContent = choice.selected ? "✓" : "";
    const copy = document.createElement("span");
    copy.className = "conversation-settings-menu-copy";
    const label = document.createElement("strong");
    label.textContent = choice.label;
    copy.append(label);
    if (choice.description) {
      const description = document.createElement("small");
      description.textContent = choice.description;
      copy.append(description);
    }
    option.append(check, copy);
    option.addEventListener("click", () => void onSelect(choice));
    menu.append(option);
  }
  menu.addEventListener("keydown", (event) => {
    const items = Array.from(menu.querySelectorAll("button"));
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  });
  return menu;
}

export function createSessionSettingsController({ element, fetchImpl = fetch, onStatus = () => {}, onChanged = () => {} }) {
  let task = null;
  let current = null;
  let options = null;
  let openKey = null;
  let pending = false;
  let bound = false;

  function dismiss(focus = false) {
    const key = openKey;
    if (!key) return;
    openKey = null;
    draw();
    if (focus) element.querySelector(`[data-setting="${key}"]`)?.focus();
  }

  async function select(key, choice) {
    const changes = changeFor(key, choice.value);
    if (!task || !changes || pending || choice.selected) { dismiss(); return; }
    const selectedTask = task;
    pending = true;
    openKey = null;
    onStatus(`正在更新 ${task.device?.name || "所属设备"} 的会话设置…`, "sending");
    draw();
    try {
      const url = `/api/tasks/${encodeURIComponent(task.id)}/settings?device=${encodeURIComponent(task.device.id)}`;
      const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`);
      if (task !== selectedTask) return;
      current = Object.freeze({ ...current, ...(result.settings || {}) });
      options = result.settingsOptions || options;
      onStatus(result.duplicate ? "设置已接收，正在同步远端状态" : settingsSavedLabel(result.activeTurnPreserved), "accepted");
      onChanged(current, options);
    } catch (error) {
      if (task !== selectedTask) return;
      onStatus(`设置失败：${error.message}`, "error");
    } finally {
      if (task === selectedTask) { pending = false; draw(); }
    }
  }

  function draw() {
    if (!task || !current) { element.replaceChildren(); return; }
    const controls = presentSessionSettings(current).map((item) => {
      const wrapper = document.createElement("span");
      wrapper.className = "conversation-setting-control";
      wrapper.setAttribute("role", "presentation");
      const button = document.createElement("button");
      const choices = settingsMenuOptions(item.key, current, options);
      button.type = "button";
      button.className = "conversation-setting";
      button.dataset.setting = item.key;
      button.dataset.tone = item.tone;
      button.disabled = pending || !choices.length;
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", String(openKey === item.key));
      button.setAttribute("aria-label", `${item.text}，${choices.length ? "可更改" : "所属节点未提供可选项"}`);
      button.title = choices.length ? item.title : `${item.title}；所属节点未提供可编辑选项`;
      const label = document.createElement("span");
      label.textContent = item.text;
      const chevron = document.createElement("span");
      chevron.className = "conversation-setting-chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "⌄";
      button.append(label, chevron);
      button.addEventListener("click", () => { openKey = openKey === item.key ? null : item.key; draw(); });
      wrapper.append(button);
      if (openKey === item.key && choices.length) {
        const menu = createMenu(item.key, choices, (choice) => select(item.key, choice), dismiss);
        wrapper.append(menu);
        queueMicrotask(() => (menu.querySelector('[aria-checked="true"]') || menu.querySelector("button"))?.focus());
      }
      return wrapper;
    });
    element.replaceChildren(...controls);
  }

  function render(nextTask, activity = null) {
    if (pending && task === nextTask) return;
    task = nextTask;
    current = mergeSessionSettings(nextTask, activity);
    options = activity?.settingsOptions || null;
    if (openKey && !settingsMenuOptions(openKey, current, options).length) openKey = null;
    if (openKey) return;
    draw();
  }

  function reset() {
    task = null;
    current = null;
    options = null;
    openKey = null;
    pending = false;
    element.replaceChildren();
  }

  function bind() {
    if (bound) return;
    bound = true;
    document.addEventListener("pointerdown", (event) => { if (openKey && !element.contains(event.target)) dismiss(); });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !openKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dismiss(true);
    });
  }

  return Object.freeze({ bind, render, reset, dismiss });
}
