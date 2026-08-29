import { createSessionsFeature } from "./features/sessions/index.js";

(() => {
  const MODULES = {
    board: { title: "看板", caption: "任务排期与对话发送" },
    console: { title: "控制台", caption: "只读本机任务记录" },
    sessions: { title: "会话中心", caption: "按工作目录查看原生 Codex 会话" },
    context: { title: "上下文状态", caption: "包装版常规聊天全局扩展；看板任务可单独覆盖" },
    priority: { title: "项目优先级", caption: "按会话活跃度与运行时间排序" },
    zotero: { title: "文献库", caption: "本机 Zotero 文献与安全回写" }
  };
  const DISPATCH_COLUMNS = ["backlog", "scheduled", "queued", "sending", "sent", "failed"];
  const requestedModule = new URLSearchParams(location.search).get("module");
  const state = {
    module: Object.hasOwn(MODULES, requestedModule) ? requestedModule : "board",
    tasks: [],
    projects: [],
    devices: [],
    dispatches: [],
    taskStatus: "loading",
    dispatchStatus: "loading",
    context: { initialized: false, status: "loading", items: [] },
    zotero: {
      initialized: false,
      status: "loading",
      summary: null,
      collections: [],
      items: [],
      total: 0,
      limit: 24,
      offset: 0,
      q: "",
      collection: "",
      requestId: 0,
      writeStatus: null,
      editor: { open: false, mode: "edit", key: "", item: null, pending: null }
    }
  };
  const $ = (selector) => document.querySelector(selector);
  const toast = $('[data-testid="toast"]');
  const consolePanel = $('[data-module-panel="console"]');
  const priorityPanel = $('[data-module-panel="priority"]');
  const zoteroPanel = $('[data-module-panel="zotero"]');
  const consoleTaskList = $('[data-testid="console-task-list"]');
  const priorityList = $('[data-testid="priority-list"]');
  const dispatchBoard = $('[data-testid="dispatch-board"]');
  const dispatchForm = $('[data-testid="dispatch-form"]');
  const contextForm = $('[data-testid="context-form"]');
  const contextList = $('[data-testid="context-list"]');
  const contextThreadOptions = $('[data-testid="context-thread-options"]');
  const projectSelect = $('[data-testid="dispatch-project"]');
  const threadSelect = $('[data-testid="dispatch-thread"]');
  const zoteroSearchForm = $('[data-testid="zotero-search-form"]');
  const zoteroSearchInput = $('[data-testid="zotero-search"]');
  const zoteroCollectionSelect = $('[data-testid="zotero-collection-filter"]');
  const zoteroCollectionList = $('[data-testid="zotero-collection-list"]');
  const zoteroItemList = $('[data-testid="zotero-item-list"]');
  const zoteroPagination = $('[data-testid="zotero-pagination"]');
  const zoteroBridgeChip = document.querySelector("[data-zotero-write-state]");
  const zoteroWriteBadge = $('[data-testid="zotero-write-status-badge"]');
  const zoteroWriteMessage = $('[data-testid="zotero-write-status-message"]');
  const zoteroAuthorizeButton = $('[data-testid="zotero-authorize"]');
  const zoteroForgetButton = $('[data-testid="zotero-forget"]');
  const zoteroEditor = $('[data-testid="zotero-editor"]');
  const zoteroEditorTitle = $('[data-testid="zotero-editor-title"]');
  const zoteroItemForm = $('[data-testid="zotero-item-form"]');
  const zoteroItemType = $('[data-testid="zotero-item-type"]');
  const zoteroNoteSection = $('[data-testid="zotero-note-section"]');
  const zoteroNoteForm = $('[data-testid="zotero-note-form"]');
  const zoteroCollectionForm = $('[data-testid="zotero-collection-form"]');
  const zoteroEditorMessage = $('[data-testid="zotero-editor-message"]');
  const zoteroEditorConflict = $('[data-testid="zotero-editor-conflict"]');
  const zoteroConfirmation = $('[data-testid="zotero-confirmation"]');
  const zoteroConfirmationSummary = $('[data-testid="zotero-confirmation-summary"]');
  const zoteroEditorVersion = $('[data-testid="zotero-editor-version"]');

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
    if (state.module === "zotero" && !state.zotero.initialized) void loadZotero();
    if (state.module === "context" && !state.context.initialized) void loadContextOverrides();
  }

  function setScopedState(panel, attribute, responseStatus, message = "") {
    for (const element of panel.querySelectorAll(`[${attribute}]`)) element.classList.toggle("hidden", element.getAttribute(attribute) !== responseStatus);
    for (const messageElement of panel.querySelectorAll(`[${attribute}-message]`)) if (message) messageElement.textContent = message;
  }

  function setTaskState(responseStatus, message = "") {
    state.taskStatus = responseStatus;
    setScopedState(consolePanel, "data-console-state", responseStatus, message);
    setScopedState(priorityPanel, "data-priority-state", responseStatus, message);
    const connected = responseStatus === "connected";
    const label = { connected: "已连接", empty: "暂无任务", disconnected: "未连接", error: "读取失败", loading: "连接中…" }[responseStatus];
    const source = connected ? "本机记录" : responseStatus === "loading" ? "读取中" : "不可用";
    $('[data-testid="console-task-count"]').textContent = connected ? String(state.tasks.length) : "—";
    $('[data-testid="console-task-source"]').textContent = source;
    $('[data-testid="console-connection-status"]').textContent = label;
    sessionsFeature.setTaskState(responseStatus, label);
    $('[data-testid="priority-project-count"]').textContent = connected ? String(state.projects.length) : "—";
    $('[data-testid="priority-recent-count"]').textContent = connected ? String(state.projects.reduce((sum, project) => sum + (project.recentSessionCount || 0), 0)) : "—";
    $('[data-testid="priority-source"]').textContent = source;
    $('[data-testid="priority-connection-status"]').textContent = label;
    $('[data-testid="connection-status"]').textContent = connected ? "目标已连接" : label;
    consoleTaskList.classList.toggle("hidden", !connected);
    priorityList.classList.toggle("hidden", !connected);
    for (const element of dispatchForm.elements) element.disabled = !connected;
  }

  function statusLabel(task) {
    if (task.status === "active") return "进行中";
    if (task.status === "completed") return "已完成";
    if (task.status === "error" || task.status === "interrupted") return "异常";
    return "待处理";
  }

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
      const span = document.createElement("span"); span.textContent = text; meta.append(span);
    }
    main.append(title, meta);
    const open = document.createElement("button");
    open.type = "button"; open.className = "task-open"; open.textContent = "在 Codex 中打开";
    open.addEventListener("click", () => requestOpen(task));
    card.append(main, open);
    return card;
  }

  function renderConsoleTasks() {
    consoleTaskList.replaceChildren(...state.tasks.map(taskCard));
  }

  function priorityCard(project, index) {
    const card = document.createElement("article");
    card.className = "priority-card";
    card.dataset.project = project.project;
    const rank = document.createElement("div"); rank.className = "priority-rank";
    const rankLabel = document.createElement("span"); rankLabel.textContent = "排名";
    const rankValue = document.createElement("strong"); rankValue.textContent = String(index + 1);
    rank.append(rankLabel, rankValue);
    const body = document.createElement("div"); body.className = "priority-card-body";
    const heading = document.createElement("div"); heading.className = "priority-card-heading";
    const name = document.createElement("h3"); name.textContent = project.project;
    const latest = document.createElement("span"); latest.textContent = `最近对话 ${formatDate(project.lastConversationAt)}`;
    heading.append(name, latest);
    const task = document.createElement("p"); task.className = "priority-latest-task"; task.textContent = project.latestTask?.title || "暂无可读取会话标题";
    const stats = document.createElement("div"); stats.className = "priority-stats";
    for (const text of [`${project.taskCount} 个会话`, `近 7 天 ${project.recentSessionCount} 个`, `运行跨度 ${formatDuration(project.totalRuntimeMs)}`]) {
      const span = document.createElement("span"); span.textContent = text; stats.append(span);
    }
    body.append(heading, task, stats);
    const score = document.createElement("div"); score.className = "priority-score";
    const scoreValue = document.createElement("strong"); scoreValue.textContent = String(project.priorityScore);
    const scoreLabel = document.createElement("span"); scoreLabel.textContent = "优先级";
    const scoreDetail = document.createElement("small"); scoreDetail.textContent = `活跃 ${project.recencyWeight} · 时长 ${project.runtimeWeight}`;
    score.append(scoreValue, scoreLabel, scoreDetail);
    card.append(rank, body, score);
    return card;
  }

  function renderPriorityProjects() {
    priorityList.replaceChildren(...state.projects.map(priorityCard));
  }

  const ZOTERO_ITEM_TYPE_LABELS = {
    journalArticle: "期刊文章",
    book: "图书",
    bookSection: "图书章节",
    conferencePaper: "会议论文",
    thesis: "学位论文",
    report: "报告",
    preprint: "预印本",
    webpage: "网页",
    document: "文档",
    dataset: "数据集",
    patent: "专利",
    presentation: "演示文稿"
  };

  function zoteroTypeLabel(type) {
    return ZOTERO_ITEM_TYPE_LABELS[type] || type || "其他条目";
  }

  function formatZoteroDate(item) {
    if (item.year) return String(item.year);
    return item.date || "日期未知";
  }

  function formatCount(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
  }

  function updateZoteroMetrics() {
    const counts = state.zotero.summary?.counts || {};
    const available = Boolean(state.zotero.summary) && !["disconnected", "error"].includes(state.zotero.status);
    $('[data-testid="zotero-item-count"]').textContent = available && state.zotero.summary ? formatCount(counts.items) : "—";
    $('[data-testid="zotero-collection-count"]').textContent = available && state.zotero.summary ? formatCount(counts.collections) : "—";
    $('[data-testid="zotero-attachment-count"]').textContent = available && state.zotero.summary ? formatCount(counts.attachments) : "—";
    $('[data-testid="zotero-note-count"]').textContent = available && state.zotero.summary ? formatCount(counts.notes) : "—";
    $('[data-testid="zotero-collection-count-label"]').textContent = available && state.zotero.summary ? formatCount(counts.collections) : "—";
  }

  function writeStatusLabel(status) {
    if (!status) return "检测中…";
    if (status.status === "offline" || status.localApi === "offline") return "Zotero 未运行";
    if (status.authorization === "authorized" || status.writeEnabled) return "回写已连接";
    if (status.authorization === "denied") return "授权被拒绝";
    if (status.status === "connected" || status.authorization === "required" || status.status === "forgot") return "需要授权";
    return "回写不可用";
  }

  function updateZoteroWriteControls() {
    const status = state.zotero.writeStatus;
    const canWrite = Boolean(status?.authorization === "authorized" && status.status !== "offline");
    for (const button of document.querySelectorAll("[data-action=\"zotero-create-item\"], [data-action=\"zotero-create-collection\"], [data-action=\"zotero-open-editor\"]")) {
      button.disabled = !canWrite;
      button.title = canWrite ? "使用已授权的 Zotero Local API" : "先连接 Zotero 回写授权";
    }
    zoteroAuthorizeButton.disabled = status?.status === "loading";
    zoteroAuthorizeButton.textContent = canWrite ? "已连接 Zotero 回写" : "连接 Zotero 回写";
    zoteroForgetButton.classList.toggle("hidden", !status?.writeEnabled && !status?.remembered);
  }

  function setZoteroWriteStatus(status, message = "") {
    state.zotero.writeStatus = status || { status: "offline", authorization: "unavailable" };
    const label = writeStatusLabel(state.zotero.writeStatus);
    const stateName = state.zotero.writeStatus.status === "offline"
      ? "offline"
      : state.zotero.writeStatus.authorization === "denied"
        ? "denied"
        : state.zotero.writeStatus.authorization === "authorized"
          ? "authorized"
          : state.zotero.writeStatus.status === "loading" ? "loading" : "unauthorized";
    zoteroBridgeChip.dataset.zoteroWriteState = stateName;
    zoteroWriteBadge.textContent = label;
    zoteroWriteMessage.textContent = message || state.zotero.writeStatus.message || "";
    updateZoteroWriteControls();
  }

  function zoteroWriteEnabled() {
    if (state.zotero.writeStatus?.writeEnabled && state.zotero.writeStatus.authorization === "authorized") return true;
    showToast(state.zotero.writeStatus?.status === "offline" ? "请先启动 Zotero，再连接回写授权。" : "请先连接 Zotero 回写授权。不会自动替你点击授权。", 5000);
    return false;
  }

  function setZoteroState(responseStatus, message = "") {
    state.zotero.status = responseStatus;
    setScopedState(zoteroPanel, "data-zotero-state", responseStatus, message);
    const label = { connected: "已连接 · 本地库", empty: "暂无匹配", disconnected: "未连接", error: "读取失败", loading: "连接中…" }[responseStatus] || "读取中…";
    $('[data-testid="zotero-connection-status"]').textContent = label;
    updateZoteroMetrics();
    const connected = responseStatus === "connected";
    zoteroItemList.classList.toggle("hidden", !connected);
    zoteroPagination.classList.toggle("hidden", !connected || state.zotero.total === 0);
    for (const element of zoteroSearchForm.elements) element.disabled = responseStatus === "loading" || responseStatus === "disconnected" || responseStatus === "error";
    updateZoteroWriteControls();
  }

  function zoteroCollectionButton(value, label, depth = 0, itemCount = null) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "zotero-collection-button";
    button.dataset.zoteroCollection = value;
    button.setAttribute("aria-pressed", String(state.zotero.collection === value));
    button.style.setProperty("--collection-depth", String(depth));
    const name = document.createElement("span");
    name.textContent = label;
    button.append(name);
    if (itemCount !== null) {
      const count = document.createElement("span");
      count.className = "zotero-collection-count";
      count.textContent = formatCount(itemCount);
      button.append(count);
    }
    return button;
  }

  function renderZoteroCollections() {
    const counts = state.zotero.summary?.counts || {};
    const allCount = Number(counts.items) || 0;
    const buttons = [zoteroCollectionButton("", "全部文献", 0, allCount)];
    const options = [new Option(`全部文献 · ${formatCount(allCount)}`, "")];
    for (const collection of state.zotero.collections) {
      const value = collection.key || String(collection.id);
      buttons.push(zoteroCollectionButton(value, collection.name, collection.depth, collection.itemCount));
      const indent = collection.depth ? `${"　".repeat(collection.depth)} ` : "";
      options.push(new Option(`${indent}${collection.name} · ${formatCount(collection.itemCount)}`, value));
    }
    zoteroCollectionList.replaceChildren(...buttons);
    zoteroCollectionSelect.replaceChildren(...options);
    zoteroCollectionSelect.value = state.zotero.collection;
  }

  function zoteroItemCard(item) {
    const card = document.createElement("article");
    card.className = "zotero-item-card";
    card.dataset.zoteroItemId = String(item.itemId || item.id || "");

    const top = document.createElement("div");
    top.className = "zotero-item-top";
    const title = document.createElement("h3");
    title.className = "zotero-item-title";
    title.textContent = item.title || "未命名条目";
    top.append(title);
    const key = document.createElement("code");
    key.className = "zotero-item-key";
    key.textContent = item.key ? `Zotero · ${item.key}` : `ID · ${item.itemId || item.id}`;
    top.append(key);

    const meta = document.createElement("div");
    meta.className = "zotero-item-meta";
    for (const text of [item.creatorText || "作者未知", formatZoteroDate(item), zoteroTypeLabel(item.itemType)]) {
      const span = document.createElement("span");
      span.textContent = text;
      meta.append(span);
    }

    card.append(top, meta);
    if (item.publication) {
      const publication = document.createElement("p");
      publication.className = "zotero-publication";
      publication.textContent = item.publication;
      card.append(publication);
    }
    if (item.tags.length) {
      const tags = document.createElement("div");
      tags.className = "zotero-tags";
      const visibleTags = item.tags.slice(0, 8);
      for (const tag of visibleTags) {
        const chip = document.createElement("span");
        chip.className = "zotero-tag";
        chip.textContent = tag;
        tags.append(chip);
      }
      if (item.tags.length > visibleTags.length) {
        const more = document.createElement("span");
        more.className = "zotero-tag zotero-tag-more";
        more.textContent = `+${item.tags.length - visibleTags.length}`;
        tags.append(more);
      }
      card.append(tags);
    }

    const footer = document.createElement("div");
    footer.className = "zotero-item-footer";
    const membership = document.createElement("span");
    membership.className = "zotero-membership";
    const names = item.collectionNames?.slice(0, 2) || [];
    membership.textContent = names.length ? `集合 · ${names.join("、")}${item.collections.length > names.length ? ` 等 ${item.collections.length} 个` : ""}` : "未加入集合";
    const details = document.createElement("span");
    details.textContent = `笔记 ${formatCount(item.noteCount)} · 附件 ${formatCount(item.attachmentCount)}`;
    footer.append(membership, details);
    const actions = document.createElement("div");
    actions.className = "zotero-item-actions";
    if (item.key) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "quiet-button small-button";
      edit.textContent = "编辑元数据";
      edit.dataset.action = "zotero-open-editor";
      edit.dataset.zoteroKey = item.key;
      actions.append(edit);
    }
    card.append(footer, actions);
    return card;
  }

  function renderZoteroItems() {
    zoteroItemList.replaceChildren(...state.zotero.items.map(zoteroItemCard));
    const start = state.zotero.total ? state.zotero.offset + 1 : 0;
    const end = state.zotero.offset + state.zotero.items.length;
    $('[data-testid="zotero-page-label"]').textContent = state.zotero.total ? `${formatCount(start)}–${formatCount(end)} / ${formatCount(state.zotero.total)}` : "0 / 0";
    $('[data-testid="zotero-previous"]').disabled = state.zotero.offset <= 0;
    $('[data-testid="zotero-next"]').disabled = !state.zotero.hasMore;
  }

  const ZOTERO_EDITABLE_FIELDS = ["title", "abstractNote", "date", "url", "DOI", "ISBN", "publicationTitle"];

  function editorField(name) {
    return zoteroItemForm.elements.namedItem(name);
  }

  function splitLines(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  function parseCreatorLines(value) {
    return splitLines(value).map((line) => {
      const separator = line.indexOf("|");
      const creatorType = separator > 0 ? line.slice(0, separator).trim() : "author";
      const name = (separator > 0 ? line.slice(separator + 1) : line).trim();
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length > 1 && creatorType !== "editor") return { creatorType, firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) };
      return { creatorType, name };
    });
  }

  function formatCreatorLines(creators) {
    return (creators || []).map((creator) => {
      const name = creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" ");
      return `${creator.creatorType || "author"}|${name}`;
    }).join("\n");
  }

  function formatTagLines(tags) {
    return (tags || []).map((tag) => typeof tag === "string" ? tag : tag.tag).filter(Boolean).join("\n");
  }

  function fillEditorItem(item) {
    for (const field of ZOTERO_EDITABLE_FIELDS) editorField(field).value = item.fields?.[field] || "";
    const itemType = item.itemType || "book";
    if (![...zoteroItemType.options].some((option) => option.value === itemType)) zoteroItemType.append(new Option(itemType, itemType));
    zoteroItemType.value = itemType;
    zoteroItemType.disabled = state.zotero.editor.mode === "edit";
    editorField("version").value = String(item.version ?? "");
    editorField("creators").value = formatCreatorLines(item.creators);
    editorField("tags").value = formatTagLines(item.tags);
    editorField("collections").value = (item.collections || []).join("\n");
    zoteroEditorVersion.textContent = `版本 ${item.version ?? "—"}`;
  }

  function setEditorMessage(message = "", isError = false) {
    zoteroEditorMessage.textContent = message;
    zoteroEditorMessage.classList.toggle("hidden", !message);
    zoteroEditorMessage.classList.toggle("is-error", isError);
  }

  function setEditorConflict(visible) {
    zoteroEditorConflict.classList.toggle("hidden", !visible);
  }

  function setEditorMode(mode, title) {
    state.zotero.editor.mode = mode;
    zoteroEditorTitle.textContent = title;
    zoteroItemForm.classList.toggle("hidden", mode === "collection");
    zoteroNoteSection.classList.toggle("hidden", mode !== "edit");
    zoteroCollectionForm.classList.toggle("hidden", mode !== "collection");
    setEditorMessage("");
    setEditorConflict(false);
    zoteroConfirmation.classList.add("hidden");
    state.zotero.editor.pending = null;
  }

  function openEditorShell() {
    zoteroEditor.classList.remove("hidden");
    zoteroEditor.setAttribute("aria-hidden", "false");
  }

  function closeEditor() {
    state.zotero.editor = { open: false, mode: "edit", key: "", item: null, pending: null };
    zoteroEditor.classList.add("hidden");
    zoteroEditor.setAttribute("aria-hidden", "true");
    setEditorMessage("");
    setEditorConflict(false);
  }

  async function openZoteroEditor(key) {
    if (!zoteroWriteEnabled()) return;
    state.zotero.editor = { open: true, mode: "edit", key, item: null, pending: null };
    setEditorMode("edit", "编辑文献");
    openEditorShell();
    setEditorMessage("正在读取 Local API 当前数据…");
    for (const element of zoteroItemForm.elements) element.disabled = true;
    try {
      const result = await fetchZoteroJson(`/api/zotero/edit/${encodeURIComponent(key)}`);
      if (result.data.status !== "ok" || !result.data.item) throw new Error(result.data.message || "当前文献不可编辑");
      state.zotero.editor.item = result.data.item;
      fillEditorItem(result.data.item);
      setEditorMessage("已读取当前版本。提交前会再次检查版本。", false);
    } catch (error) {
      setEditorMessage(error.message || "无法读取当前文献。", true);
    } finally {
      for (const element of zoteroItemForm.elements) element.disabled = false;
      zoteroItemType.disabled = true;
    }
  }

  function openZoteroCreateItem() {
    if (!zoteroWriteEnabled()) return;
    state.zotero.editor = { open: true, mode: "create", key: "", item: null, pending: null };
    setEditorMode("create", "新建文献");
    openEditorShell();
    zoteroItemForm.reset();
    zoteroItemType.disabled = false;
    zoteroItemType.value = "book";
    editorField("creators").value = "";
    editorField("tags").value = "";
    editorField("collections").value = "";
    zoteroEditorVersion.textContent = "新条目 · 尚无版本";
    setEditorMessage("新条目只会发送你填写的文献元数据。", false);
  }

  function openZoteroCreateCollection() {
    if (!zoteroWriteEnabled()) return;
    state.zotero.editor = { open: true, mode: "collection", key: "", item: null, pending: null };
    setEditorMode("collection", "新建集合");
    openEditorShell();
    zoteroCollectionForm.reset();
    setEditorMessage("只会创建集合，不会移动或删除现有内容。", false);
  }

  function itemFormBody() {
    const fields = Object.fromEntries(ZOTERO_EDITABLE_FIELDS.map((field) => [field, editorField(field).value.trim()]));
    const body = {
      fields,
      creators: parseCreatorLines(editorField("creators").value),
      tags: splitLines(editorField("tags").value).map((tag) => ({ tag, type: 0 })),
      collections: splitLines(editorField("collections").value)
    };
    if (state.zotero.editor.mode === "edit") {
      body.version = Number(editorField("version").value);
      body.completeLists = ["creators", "tags", "collections"];
    } else body.itemType = zoteroItemType.value;
    return body;
  }

  function itemChangeSummary(body) {
    const title = body.fields.title || "未命名条目";
    if (state.zotero.editor.mode === "create") return `创建 ${body.itemType}：${title}\n作者 ${body.creators.length} 位 · 标签 ${body.tags.length} 个 · 集合 ${body.collections.length} 个`;
    const original = state.zotero.editor.item?.fields || {};
    const changes = ZOTERO_EDITABLE_FIELDS.filter((field) => body.fields[field] !== (original[field] || ""));
    const listSummary = `完整替换作者 ${body.creators.length} 位、标签 ${body.tags.length} 个、集合 ${body.collections.length} 个`;
    return `更新“${title}”\n${changes.length ? `修改字段：${changes.join("、")}\n` : "标量字段无变化\n"}${listSummary}\n提交版本：${body.version}`;
  }

  function queueZoteroWrite(pending) {
    state.zotero.editor.pending = pending;
    zoteroConfirmationSummary.textContent = pending.summary;
    zoteroConfirmation.classList.remove("hidden");
    setEditorMessage("请核对下面的完整写入摘要。确认后才会请求 Zotero。", false);
    zoteroConfirmation.scrollIntoView({ block: "nearest" });
  }

  async function confirmZoteroWrite() {
    const pending = state.zotero.editor.pending;
    if (!pending) return;
    const confirmButton = $('[data-testid="zotero-confirm"]');
    confirmButton.disabled = true;
    try {
      const result = await fetchZoteroJson(pending.path, {
        method: pending.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.body)
      });
      const data = result.data;
      if (!result.response.ok) {
        state.zotero.editor.pending = null;
        zoteroConfirmation.classList.add("hidden");
        if (result.response.status === 412 || data.status === "conflict") {
          setEditorConflict(true);
          setEditorMessage(data.message || "版本冲突，请重新加载当前数据。", true);
        } else setEditorMessage(data.message || `Zotero 写入失败（HTTP ${result.response.status}）。`, true);
        if (["unauthorized", "denied"].includes(data.status)) await loadZoteroWriteStatus();
        return;
      }
      state.zotero.editor.pending = null;
      zoteroConfirmation.classList.add("hidden");
      setEditorConflict(false);
      setEditorMessage(data.message || "Zotero 写入成功。", false);
      if (pending.kind === "edit") {
        const nextVersion = Number(data.version);
        if (Number.isInteger(nextVersion)) {
          editorField("version").value = String(nextVersion);
          zoteroEditorVersion.textContent = `版本 ${nextVersion}`;
        }
        state.zotero.editor.item = { ...state.zotero.editor.item, version: nextVersion, fields: pending.body.fields, creators: pending.body.creators, tags: pending.body.tags, collections: pending.body.collections };
        await loadZoteroItems();
      } else if (pending.kind === "note") {
        zoteroNoteForm.reset();
      } else {
        await loadZotero();
        if (pending.kind === "collection") closeEditor();
      }
      await loadZoteroWriteStatus();
    } catch (error) {
      setEditorMessage(error.message || "无法连接 Zotero 回写服务。", true);
    } finally {
      confirmButton.disabled = false;
    }
  }

  async function loadZoteroWriteStatus() {
    try {
      const result = await fetchZoteroJson("/api/zotero/write-status");
      setZoteroWriteStatus(result.data);
    } catch (error) {
      setZoteroWriteStatus({ status: "offline", authorization: "unavailable", message: error.message });
    }
  }

  async function authorizeZotero() {
    setZoteroWriteStatus({ status: "loading", authorization: "unknown", message: "正在请求 Zotero 授权…" });
    try {
      const result = await fetchZoteroJson("/api/zotero/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      setZoteroWriteStatus(result.data);
      if (result.data.status === "authorized") showToast("回写授权已连接；Zotero 的 Always Allow / Allow 选择由你决定。");
      else if (result.data.message) showToast(result.data.message);
    } catch (error) {
      setZoteroWriteStatus({ status: "offline", authorization: "unavailable", message: error.message });
    }
  }

  async function forgetZoteroAuthorization() {
    try {
      const result = await fetchZoteroJson("/api/zotero/forget-authorization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      });
      setZoteroWriteStatus(result.data);
      showToast(result.data.message || "已忘记本地授权。");
    } catch (error) {
      showToast(error.message || "无法忘记本地授权。");
    }
  }

  function zoteroItemsUrl() {
    const params = new URLSearchParams({ limit: String(state.zotero.limit), offset: String(state.zotero.offset) });
    if (state.zotero.q) params.set("q", state.zotero.q);
    if (state.zotero.collection) params.set("collection", state.zotero.collection);
    return `/api/zotero/items?${params.toString()}`;
  }

  async function fetchZoteroJson(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`HTTP ${response.status}`);
    }
    if (!response.ok && !data?.status) throw new Error(data?.message || `HTTP ${response.status}`);
    return { response, data };
  }

  async function loadZoteroItems(requestId = ++state.zotero.requestId) {
    zoteroItemList.setAttribute("aria-busy", "true");
    try {
      const result = await fetchZoteroJson(zoteroItemsUrl());
      if (requestId !== state.zotero.requestId) return;
      const data = result.data;
      if (data.status === "disconnected") {
        state.zotero.items = [];
        state.zotero.total = 0;
        setZoteroState("disconnected", data.message);
        return;
      }
      state.zotero.items = Array.isArray(data.items) ? data.items : [];
      state.zotero.total = Number(data.total) || 0;
      state.zotero.limit = Number(data.limit) || state.zotero.limit;
      state.zotero.offset = Number(data.offset) || 0;
      state.zotero.hasMore = Boolean(data.hasMore);
      renderZoteroItems();
      if (state.zotero.items.length) setZoteroState("connected");
      else setZoteroState("empty", state.zotero.q || state.zotero.collection ? "没有符合当前搜索或集合筛选的文献。" : (data.message || "还没有可显示的文献。"));
    } catch (error) {
      if (requestId !== state.zotero.requestId) return;
      state.zotero.items = [];
      state.zotero.total = 0;
      setZoteroState("error", `无法连接到文献服务：${error.message}`);
    } finally {
      if (requestId === state.zotero.requestId) zoteroItemList.removeAttribute("aria-busy");
    }
  }

  async function loadZotero() {
    const requestId = ++state.zotero.requestId;
    state.zotero.initialized = true;
    state.zotero.items = [];
    state.zotero.total = 0;
    setZoteroState("loading");
    try {
      const [statusResult, collectionResult, writeResult] = await Promise.all([
        fetchZoteroJson("/api/zotero/status"),
        fetchZoteroJson("/api/zotero/collections"),
        fetchZoteroJson("/api/zotero/write-status")
      ]);
      if (requestId !== state.zotero.requestId) return;
      state.zotero.summary = statusResult.data;
      state.zotero.collections = Array.isArray(collectionResult.data.collections) ? collectionResult.data.collections : [];
      setZoteroWriteStatus(writeResult.data);
      renderZoteroCollections();
      if (statusResult.data.status === "disconnected") {
        setZoteroState("disconnected", statusResult.data.message);
        return;
      }
      await loadZoteroItems(requestId);
    } catch (error) {
      if (requestId !== state.zotero.requestId) return;
      setZoteroState("error", `无法读取本机 Zotero：${error.message}`);
    }
  }

  function updateDestinationSelectors() {
    const currentProject = projectSelect.value;
    const names = [...new Set(state.tasks.map((task) => task.project || "未归类"))].sort((left, right) => left.localeCompare(right, "zh-CN"));
    projectSelect.replaceChildren(new Option("选择项目", ""), ...names.map((name) => new Option(name, name)));
    if (names.includes(currentProject)) projectSelect.value = currentProject;
    updateThreadSelector();
  }

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

  function dispatchColumnStatus(status) {
    return status === "cancelled" ? "failed" : status;
  }

  function dispatchAction(label, action, item, className = "task-open") {
    const button = document.createElement("button");
    button.type = "button"; button.className = className; button.textContent = label;
    button.dataset.dispatchAction = action; button.dataset.dispatchId = item.id;
    return button;
  }

  function dispatchCard(item) {
    const card = document.createElement("article");
    card.className = "dispatch-card";
    card.dataset.dispatchId = item.id;
    const title = document.createElement("h4"); title.textContent = item.title;
    const route = document.createElement("div"); route.className = "dispatch-route"; route.textContent = `${item.project} → ${item.targetThreadTitle}`;
    const prompt = document.createElement("p"); prompt.textContent = item.prompt;
    const meta = document.createElement("div"); meta.className = "dispatch-meta";
    meta.textContent = item.status === "scheduled" ? `计划 ${formatDate(item.scheduledAt)}` : item.status === "sending" ? `开始 ${formatDate(item.startedAt)}` : `更新 ${formatDate(item.updatedAt)}`;
    if (item.lastError) {
      const error = document.createElement("div"); error.className = "dispatch-error"; error.textContent = item.lastError; card.append(title, route, prompt, meta, error);
    } else card.append(title, route, prompt, meta);
    const actions = document.createElement("div"); actions.className = "dispatch-actions";
    if (["backlog", "scheduled", "failed", "cancelled"].includes(item.status)) actions.append(dispatchAction("立即排队", "queue", item, "primary-button small-button"));
    if (["queued", "scheduled"].includes(item.status)) actions.append(dispatchAction("移到待排期", "backlog", item));
    if (item.status !== "sending") actions.append(dispatchAction("删除", "delete", item, "quiet-button small-button"));
    card.append(actions);
    return card;
  }

  function renderDispatches() {
    for (const column of DISPATCH_COLUMNS) {
      const items = state.dispatches.filter((item) => dispatchColumnStatus(item.status) === column);
      $(`[data-dispatch-count="${column}"]`).textContent = String(items.length);
      const list = $(`[data-dispatch-list="${column}"]`);
      list.replaceChildren(...items.map(dispatchCard));
      if (!items.length) {
        const empty = document.createElement("div"); empty.className = "column-empty"; empty.textContent = "暂无任务"; list.append(empty);
      }
    }
    $('[data-testid="dispatch-count"]').textContent = String(state.dispatches.length);
    $('[data-testid="dispatch-waiting-count"]').textContent = String(state.dispatches.filter((item) => ["scheduled", "queued", "sending"].includes(item.status)).length);
    $('[data-testid="dispatch-target-count"]').textContent = String(new Set(state.dispatches.map((item) => item.targetThreadId)).size);
  }

  function setDispatchState(status, message = "") {
    state.dispatchStatus = status;
    for (const element of document.querySelectorAll("[data-dispatch-state]")) element.classList.toggle("hidden", element.dataset.dispatchState !== status);
    const messageElement = $("[data-dispatch-state-message]");
    if (message && messageElement) messageElement.textContent = message;
    dispatchBoard.classList.toggle("hidden", status !== "connected");
  }

  function renderContextThreadOptions() {
    contextThreadOptions.replaceChildren(...state.tasks.map((task) => {
      const option = document.createElement("option");
      option.value = task.id;
      option.label = `${task.project || "未归类"} · ${task.title}`;
      return option;
    }));
  }

  function contextCard(item) {
    const card = document.createElement("article");
    card.className = "context-card";
    card.dataset.threadId = item.threadId;
    const heading = document.createElement("div");
    heading.className = "context-card-heading";
    const titleGroup = document.createElement("div");
    const title = document.createElement("h3"); title.textContent = item.threadTitle;
    const id = document.createElement("code"); id.textContent = item.threadId;
    titleGroup.append(title, id);
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "quiet-button"; remove.textContent = "移除覆盖";
    remove.dataset.contextAction = "remove"; remove.dataset.threadId = item.threadId;
    heading.append(titleGroup, remove);

    const values = document.createElement("div");
    values.className = "context-values";
    const rows = [
      ["请求值", formatTokens(item.requestedContextWindow)],
      [item.clamped ? "模型接受值（已钳制）" : "模型接受值", formatTokens(item.acceptedContextWindow)],
      [`预计有效值（${item.effectiveContextWindowPercent}%）`, formatTokens(item.estimatedEffectiveContextWindow)],
      ["最近观测值", formatTokens(item.observedContextWindow)]
    ];
    for (const [label, value] of rows) {
      const metric = document.createElement("div");
      const name = document.createElement("span"); name.textContent = label;
      const strong = document.createElement("strong"); strong.textContent = value;
      metric.append(name, strong); values.append(metric);
    }
    const footer = document.createElement("p");
    footer.className = "context-card-footer";
    footer.textContent = `${item.project || "项目未知"} · ${item.model || "模型未知"} · 保存于 ${formatDate(item.updatedAt)}${item.taskAvailable ? "" : " · 会话记录当前不可读"}`;
    card.append(heading, values, footer);
    return card;
  }

  function setContextState(status, message = "") {
    state.context.status = status;
    for (const element of document.querySelectorAll("[data-context-state]")) element.classList.toggle("hidden", element.dataset.contextState !== status);
    const messageElement = $("[data-context-state-message]");
    if (message && messageElement) messageElement.textContent = message;
    $('[data-testid="context-count"]').textContent = status === "connected" || status === "empty" ? String(state.context.items.length) : "—";
    $('[data-testid="context-million-count"]').textContent = status === "connected" || status === "empty"
      ? String(state.context.items.filter((item) => item.requestedContextWindow >= 1_000_000).length)
      : "—";
    $('[data-testid="context-status"]').textContent = { loading: "读取中", connected: "已启用", empty: "未配置", error: "异常" }[status] || "未知";
  }

  async function loadContextOverrides({ quiet = false } = {}) {
    state.context.initialized = true;
    if (!quiet) setContextState("loading");
    try {
      const response = await fetch("/api/context-overrides", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      state.context.items = Array.isArray(data.items) ? data.items : [];
      contextList.replaceChildren(...state.context.items.map(contextCard));
      setContextState(state.context.items.length ? "connected" : "empty");
    } catch (error) {
      setContextState("error", error.message);
    }
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
      renderContextThreadOptions();
      if (data.status === "connected" && state.tasks.length) {
        setTaskState("connected"); renderConsoleTasks(); sessionsFeature.render(); renderPriorityProjects(); updateDestinationSelectors();
      } else if (data.status === "empty") setTaskState("empty", data.message);
      else if (data.status === "disconnected") setTaskState("disconnected", data.message);
      else setTaskState("error", data.message || "任务数据不可用。");
    } catch (error) {
      setTaskState("disconnected", `无法连接到控制台服务：${error.message}`);
    }
  }

  async function loadDispatches({ quiet = false } = {}) {
    if (!quiet) setDispatchState("loading");
    try {
      const response = await fetch("/api/dispatches", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
      state.dispatches = Array.isArray(data.items) ? data.items : [];
      setDispatchState("connected"); renderDispatches();
    } catch (error) {
      setDispatchState("error", error.message);
    }
  }

  async function mutateDispatch(path, method, body) {
    const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
    return data;
  }

  function requestOpen(task) {
    if (window.parent === window) return showToast("请在 Codex 控制台中打开任务。");
    window.parent.postMessage({
      type: "codex-control-console-open-task",
      task: { id: task.id, title: task.title, device: task.device || null }
    }, "*");
    showToast("正在请求 Codex 打开任务…");
  }

  const sessionsFeature = createSessionsFeature({ state, $, formatDate, statusLabel, requestOpen });
  sessionsFeature.bind();

  projectSelect.addEventListener("change", updateThreadSelector);
  zoteroSearchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.zotero.q = zoteroSearchInput.value.trim().slice(0, 200);
    state.zotero.offset = 0;
    void loadZoteroItems();
  });
  zoteroCollectionSelect.addEventListener("change", () => {
    state.zotero.collection = zoteroCollectionSelect.value;
    state.zotero.offset = 0;
    renderZoteroCollections();
    void loadZoteroItems();
  });
  zoteroItemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!zoteroWriteEnabled()) return;
    const body = itemFormBody();
    const edit = state.zotero.editor.mode === "edit";
    queueZoteroWrite({
      kind: edit ? "edit" : "create",
      method: edit ? "PATCH" : "POST",
      path: edit ? `/api/zotero/edit/${encodeURIComponent(state.zotero.editor.key)}` : "/api/zotero/items",
      body,
      summary: itemChangeSummary(body)
    });
  });
  zoteroNoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!zoteroWriteEnabled() || !state.zotero.editor.key) return;
    const formData = new FormData(zoteroNoteForm);
    const body = { title: String(formData.get("title") || "").trim(), note: String(formData.get("note") || "").trim() };
    if (!body.note) return showToast("笔记内容不能为空。");
    queueZoteroWrite({
      kind: "note",
      method: "POST",
      path: `/api/zotero/items/${encodeURIComponent(state.zotero.editor.key)}/notes`,
      body,
      summary: `为“${state.zotero.editor.item?.fields?.title || state.zotero.editor.key}”添加子笔记\n${body.title ? `标题：${body.title}\n` : ""}内容：${body.note.slice(0, 160)}${body.note.length > 160 ? "…" : ""}`
    });
  });
  zoteroCollectionForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!zoteroWriteEnabled()) return;
    const formData = new FormData(zoteroCollectionForm);
    const body = { name: String(formData.get("name") || "").trim() };
    const parentCollection = String(formData.get("parentCollection") || "").trim();
    if (parentCollection) body.parentCollection = parentCollection;
    if (!body.name) return showToast("集合名称不能为空。");
    queueZoteroWrite({ kind: "collection", method: "POST", path: "/api/zotero/collections", body, summary: `创建集合：${body.name}${parentCollection ? `\n父集合 key：${parentCollection}` : ""}` });
  });
  dispatchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(dispatchForm));
    if (data.mode === "schedule" && !data.scheduledAt) return showToast("选择“按时间发送”时必须设置发送时间。");
    if (data.scheduledAt) data.scheduledAt = new Date(data.scheduledAt).toISOString();
    try {
      await mutateDispatch("/api/dispatches", "POST", data);
      dispatchForm.reset(); updateDestinationSelectors();
      await loadDispatches({ quiet: true }); showToast("任务已加入看板。");
    } catch (error) { showToast(error.message); }
  });
  contextForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(contextForm));
    const threadId = String(data.threadId || "").trim();
    try {
      const result = await mutateDispatch(`/api/context-overrides/${encodeURIComponent(threadId)}`, "PUT", { contextWindow: Number(data.contextWindow) });
      await loadContextOverrides({ quiet: true });
      showToast(result.item.clamped
        ? `已保存；模型会将请求钳制为 ${formatTokens(result.item.acceptedContextWindow)} tokens。`
        : `已为该会话保存 ${formatTokens(result.item.requestedContextWindow)} tokens。`);
    } catch (error) { showToast(error.message); }
  });

  document.addEventListener("click", async (event) => {
    const zoteroCollection = event.target.closest("[data-zotero-collection]");
    if (zoteroCollection) {
      state.zotero.collection = zoteroCollection.dataset.zoteroCollection || "";
      state.zotero.offset = 0;
      zoteroCollectionSelect.value = state.zotero.collection;
      renderZoteroCollections();
      await loadZoteroItems();
      return;
    }
    const dispatchButton = event.target.closest("[data-dispatch-action]");
    if (dispatchButton) {
      dispatchButton.disabled = true;
      try {
        if (dispatchButton.dataset.dispatchAction === "delete") await mutateDispatch(`/api/dispatches/${encodeURIComponent(dispatchButton.dataset.dispatchId)}`, "DELETE");
        else await mutateDispatch(`/api/dispatches/${encodeURIComponent(dispatchButton.dataset.dispatchId)}`, "PATCH", { status: dispatchButton.dataset.dispatchAction === "queue" ? "queued" : "backlog" });
        await loadDispatches({ quiet: true });
      } catch (error) { showToast(error.message); dispatchButton.disabled = false; }
      return;
    }
    const contextButton = event.target.closest("[data-context-action]");
    if (contextButton) {
      contextButton.disabled = true;
      try {
        await mutateDispatch(`/api/context-overrides/${encodeURIComponent(contextButton.dataset.threadId)}`, "DELETE");
        await loadContextOverrides({ quiet: true });
        showToast("已移除该会话的上下文覆盖。");
      } catch (error) { showToast(error.message); contextButton.disabled = false; }
      return;
    }
    const actionElement = event.target.closest("[data-action]");
    const action = actionElement?.dataset.action;
    if (action === "refresh") {
      const refreshes = [loadTasks(), loadDispatches()];
      if (state.module === "zotero") refreshes.push(loadZotero());
      if (state.module === "context") refreshes.push(loadContextOverrides());
      await Promise.all(refreshes);
    }
    if (action === "refresh-dispatches") await loadDispatches();
    if (action === "refresh-context") await loadContextOverrides();
    if (action === "module") showModule(actionElement.dataset.moduleTarget, true);
    if (action === "zotero-refresh") await loadZotero();
    if (action === "zotero-authorize") await authorizeZotero();
    if (action === "zotero-forget") await forgetZoteroAuthorization();
    if (action === "zotero-open-editor") await openZoteroEditor(actionElement.dataset.zoteroKey);
    if (action === "zotero-create-item") openZoteroCreateItem();
    if (action === "zotero-create-collection") openZoteroCreateCollection();
    if (action === "zotero-close-editor") closeEditor();
    if (action === "zotero-confirm") await confirmZoteroWrite();
    if (action === "zotero-cancel-confirm") {
      state.zotero.editor.pending = null;
      zoteroConfirmation.classList.add("hidden");
      setEditorMessage("已返回修改，尚未请求 Zotero。", false);
    }
    if (action === "zotero-reload-editor" && state.zotero.editor.key) await openZoteroEditor(state.zotero.editor.key);
    if (action === "zotero-clear") {
      state.zotero.q = "";
      state.zotero.collection = "";
      state.zotero.offset = 0;
      zoteroSearchInput.value = "";
      zoteroCollectionSelect.value = "";
      renderZoteroCollections();
      await loadZoteroItems();
    }
    if (action === "zotero-page") {
      const direction = actionElement.dataset.pageDirection;
      if (direction === "next" && state.zotero.hasMore) state.zotero.offset += state.zotero.limit;
      if (direction === "previous") state.zotero.offset = Math.max(0, state.zotero.offset - state.zotero.limit);
      await loadZoteroItems();
    }
    if (action === "close" && window.parent !== window) window.parent.postMessage({ type: "codex-control-console-close" }, "*");
  });

  window.addEventListener("message", (event) => {
    if (event.data?.type === "codex-control-console-show-module") return showModule(event.data.module, true);
    if (event.data?.type !== "codex-control-console-open-task-result") return;
    const result = event.data.result || {};
    showToast(result.ok ? `已请求打开：${result.title || "任务"}` : result.message || "该任务暂不支持直接打开。");
  });

  updateModuleChrome();
  Promise.all([loadTasks(), loadDispatches()]);
  if (state.module === "zotero") void loadZotero();
  if (state.module === "context") void loadContextOverrides();
  setInterval(() => void loadDispatches({ quiet: true }), 2500);
})();
