import { createConsoleFeature } from "./features/console/index.js";
import { createContextFeature } from "./features/context/index.js";
import { createDispatchFeature } from "./features/dispatch/index.js";
import { createPriorityFeature } from "./features/priority/index.js";
import { createSessionsFeature } from "./features/sessions/index.js";
import { createZoteroFeature } from "./features/zotero/index.js";

(() => {
  const MODULES = {
    board: { title: "看板", caption: "任务排期与对话发送" },
    console: { title: "控制台", caption: "只读本机任务记录" },
    sessions: { title: "会话中心", caption: "按工作目录查看原生 Codex 会话" },
    context: { title: "上下文状态", caption: "包装版常规聊天全局扩展；看板任务可单独覆盖" },
    priority: { title: "项目优先级", caption: "按会话活跃度与运行时间排序" },
    zotero: { title: "文献库", caption: "本机 Zotero 文献与安全回写" }
  };
  const requestedModule = new URLSearchParams(location.search).get("module");
  const state = {
    module: Object.hasOwn(MODULES, requestedModule) ? requestedModule : "board",
    tasks: [], projects: [], devices: [], dispatches: [],
    taskStatus: "loading", dispatchStatus: "loading",
    context: { initialized: false, status: "loading", items: [] },
    zotero: {
      initialized: false, status: "loading", summary: null, collections: [], items: [],
      total: 0, limit: 24, offset: 0, q: "", collection: "", requestId: 0, writeStatus: null,
      editor: { open: false, mode: "edit", key: "", item: null, pending: null }
    }
  };
  const $ = (selector) => document.querySelector(selector);
  const toast = $('[data-testid="toast"]');

  function showToast(message, duration = 3800) {
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.add("hidden"), duration);
  }

  function formatDate(value) {
    if (!value) return "时间未知";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDuration(value) {
    const hours = Number(value) / 3600000;
    if (!Number.isFinite(hours) || hours <= 0) return "不足 1 分钟";
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟`;
    if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)} 小时`;
    return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)} 天`;
  }

  function formatTokens(value) {
    const tokens = Number(value);
    return Number.isFinite(tokens) ? new Intl.NumberFormat("zh-CN").format(tokens) : "未知";
  }

  function setScopedState(panel, attribute, responseStatus, message = "") {
    for (const element of panel.querySelectorAll(`[${attribute}]`)) element.classList.toggle("hidden", element.getAttribute(attribute) !== responseStatus);
    for (const messageElement of panel.querySelectorAll(`[${attribute}-message]`)) if (message) messageElement.textContent = message;
  }

  function updateModuleChrome() {
    const module = MODULES[state.module];
    $('[data-testid="module-title"]').textContent = module.title;
    $('[data-testid="module-caption"]').textContent = module.caption;
    document.title = `${module.title} · Codex`;
    for (const tab of document.querySelectorAll("[data-module-target]")) {
      const selected = tab.dataset.moduleTarget === state.module;
      tab.classList.toggle("is-active", selected);
      if (selected) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    for (const panel of document.querySelectorAll("[data-module-panel]")) panel.classList.toggle("hidden", panel.dataset.modulePanel !== state.module);
  }

  function showModule(module, announce = false) {
    state.module = Object.hasOwn(MODULES, module) ? module : "board";
    updateModuleChrome();
    if (announce) showToast(`${MODULES[state.module].title}已打开`);
    if (state.module === "zotero" && !state.zotero.initialized) void zoteroFeature.load();
    if (state.module === "context" && !state.context.initialized) void contextFeature.load();
  }

  function setTaskState(responseStatus, message = "") {
    state.taskStatus = responseStatus;
    const connected = responseStatus === "connected";
    const label = { connected: "已连接", empty: "暂无任务", disconnected: "未连接", error: "读取失败", loading: "连接中…" }[responseStatus];
    const source = connected ? "本机记录" : responseStatus === "loading" ? "读取中" : "不可用";
    consoleFeature.setTaskState(responseStatus, label, message);
    sessionsFeature.setTaskState(responseStatus, label);
    priorityFeature.setTaskState(responseStatus, label, source, message);
    dispatchFeature.setTaskState(responseStatus, label);
  }

  function statusLabel(task) {
    if (task.status === "active") return "进行中";
    if (task.status === "completed") return "已完成";
    if (task.status === "error" || task.status === "interrupted") return "异常";
    return "待处理";
  }

  async function loadTasks() {
    setTaskState("loading");
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.tasks = Array.isArray(data.tasks) ? data.tasks : [];
      state.projects = Array.isArray(data.projects) ? data.projects : [];
      state.devices = Array.isArray(data.devices) ? data.devices : [];
      contextFeature.renderThreadOptions();
      if (data.status === "connected" && state.tasks.length) {
        setTaskState("connected");
        consoleFeature.render(); sessionsFeature.render(); priorityFeature.render(); dispatchFeature.updateDestinations();
      } else if (data.status === "empty") setTaskState("empty", data.message);
      else if (data.status === "disconnected") setTaskState("disconnected", data.message);
      else setTaskState("error", data.message || "任务数据不可用。");
    } catch (error) {
      setTaskState("disconnected", `无法连接到控制台服务：${error.message}`);
    }
  }

  function requestOpen(task) {
    if (window.parent === window) return showToast("请在 Codex 控制台中打开任务。");
    window.parent.postMessage({ type: "codex-control-console-open-task", task: { id: task.id, title: task.title, device: task.device || null } }, "*");
    showToast("正在请求 Codex 打开任务…");
  }

  const consoleFeature = createConsoleFeature({ state, $, formatDate, statusLabel, requestOpen });
  const contextFeature = createContextFeature({ state, $, formatDate, formatTokens, showToast });
  const dispatchFeature = createDispatchFeature({ state, $, formatDate, showToast });
  const priorityFeature = createPriorityFeature({ state, $, formatDate, formatDuration });
  const sessionsFeature = createSessionsFeature({ state, $, formatDate, statusLabel, requestOpen });
  const zoteroFeature = createZoteroFeature({ state, $, setScopedState, showToast });
  contextFeature.bind(); dispatchFeature.bind(); sessionsFeature.bind(); zoteroFeature.bind();

  document.addEventListener("click", async (event) => {
    const element = event.target.closest("[data-action]");
    const action = element?.dataset.action;
    if (action === "refresh") {
      const refreshes = [loadTasks(), dispatchFeature.load()];
      if (state.module === "zotero") refreshes.push(zoteroFeature.load());
      if (state.module === "context") refreshes.push(contextFeature.load());
      await Promise.all(refreshes);
    }
    if (action === "module") showModule(element.dataset.moduleTarget, true);
    if (action === "close" && window.parent !== window) window.parent.postMessage({ type: "codex-control-console-close" }, "*");
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type === "codex-control-console-show-module") return showModule(event.data.module, true);
    if (event.data?.type !== "codex-control-console-open-task-result") return;
    const result = event.data.result || {};
    showToast(result.ok ? `已请求打开：${result.title || "任务"}` : result.message || "该任务暂不支持直接打开。");
  });

  updateModuleChrome();
  Promise.all([loadTasks(), dispatchFeature.load()]);
  if (state.module === "zotero") void zoteroFeature.load();
  if (state.module === "context") void contextFeature.load();
  setInterval(() => void dispatchFeature.load({ quiet: true }), 2500);
})();
