import { EDITABLE_FIELDS, formatCreatorLines, formatTagLines, parseCreatorLines, splitLines, writeStatusLabel } from "./format.js";

export function createZoteroEditor({ state, $, panel, showToast, fetchJson, reloadItems, reloadAll }) {
  const bridgeChip = document.querySelector("[data-zotero-write-state]");
  const writeBadge = $('[data-testid="zotero-write-status-badge"]');
  const writeMessage = $('[data-testid="zotero-write-status-message"]');
  const authorizeButton = $('[data-testid="zotero-authorize"]');
  const forgetButton = $('[data-testid="zotero-forget"]');
  const editor = $('[data-testid="zotero-editor"]');
  const editorTitle = $('[data-testid="zotero-editor-title"]');
  const itemForm = $('[data-testid="zotero-item-form"]');
  const itemType = $('[data-testid="zotero-item-type"]');
  const noteSection = $('[data-testid="zotero-note-section"]');
  const noteForm = $('[data-testid="zotero-note-form"]');
  const collectionForm = $('[data-testid="zotero-collection-form"]');
  const editorMessage = $('[data-testid="zotero-editor-message"]');
  const editorConflict = $('[data-testid="zotero-editor-conflict"]');
  const confirmation = $('[data-testid="zotero-confirmation"]');
  const confirmationSummary = $('[data-testid="zotero-confirmation-summary"]');
  const editorVersion = $('[data-testid="zotero-editor-version"]');

  function updateControls() {
    const status = state.zotero.writeStatus;
    const canWrite = Boolean(status?.authorization === "authorized" && status.status !== "offline");
    for (const button of document.querySelectorAll('[data-action="zotero-create-item"], [data-action="zotero-create-collection"], [data-action="zotero-open-editor"]')) {
      button.disabled = !canWrite;
      button.title = canWrite ? "使用已授权的 Zotero Local API" : "先连接 Zotero 回写授权";
    }
    authorizeButton.disabled = status?.status === "loading";
    authorizeButton.textContent = canWrite ? "已连接 Zotero 回写" : "连接 Zotero 回写";
    forgetButton.classList.toggle("hidden", !status?.writeEnabled && !status?.remembered);
  }

  function setWriteStatus(status, message = "") {
    state.zotero.writeStatus = status || { status: "offline", authorization: "unavailable" };
    const current = state.zotero.writeStatus;
    const stateName = current.status === "offline" ? "offline"
      : current.authorization === "denied" ? "denied"
        : current.authorization === "authorized" ? "authorized"
          : current.status === "loading" ? "loading" : "unauthorized";
    bridgeChip.dataset.zoteroWriteState = stateName;
    writeBadge.textContent = writeStatusLabel(current);
    writeMessage.textContent = message || current.message || "";
    updateControls();
  }

  function writeEnabled() {
    if (state.zotero.writeStatus?.writeEnabled && state.zotero.writeStatus.authorization === "authorized") return true;
    showToast(state.zotero.writeStatus?.status === "offline" ? "请先启动 Zotero，再连接回写授权。" : "请先连接 Zotero 回写授权。不会自动替你点击授权。", 5000);
    return false;
  }

  function field(name) {
    return itemForm.elements.namedItem(name);
  }

  function setMessage(message = "", isError = false) {
    editorMessage.textContent = message;
    editorMessage.classList.toggle("hidden", !message);
    editorMessage.classList.toggle("is-error", isError);
  }

  function setConflict(visible) {
    editorConflict.classList.toggle("hidden", !visible);
  }

  function setMode(mode, title) {
    state.zotero.editor.mode = mode;
    editorTitle.textContent = title;
    itemForm.classList.toggle("hidden", mode === "collection");
    noteSection.classList.toggle("hidden", mode !== "edit");
    collectionForm.classList.toggle("hidden", mode !== "collection");
    setMessage();
    setConflict(false);
    confirmation.classList.add("hidden");
    state.zotero.editor.pending = null;
  }

  function openShell() {
    editor.classList.remove("hidden");
    editor.setAttribute("aria-hidden", "false");
  }

  function close() {
    state.zotero.editor = { open: false, mode: "edit", key: "", item: null, pending: null };
    editor.classList.add("hidden");
    editor.setAttribute("aria-hidden", "true");
    setMessage();
    setConflict(false);
  }

  function fillItem(item) {
    for (const name of EDITABLE_FIELDS) field(name).value = item.fields?.[name] || "";
    const type = item.itemType || "book";
    if (![...itemType.options].some((option) => option.value === type)) itemType.append(new Option(type, type));
    itemType.value = type;
    itemType.disabled = state.zotero.editor.mode === "edit";
    field("version").value = String(item.version ?? "");
    field("creators").value = formatCreatorLines(item.creators);
    field("tags").value = formatTagLines(item.tags);
    field("collections").value = (item.collections || []).join("\n");
    editorVersion.textContent = `版本 ${item.version ?? "—"}`;
  }

  async function open(key) {
    if (!writeEnabled()) return;
    state.zotero.editor = { open: true, mode: "edit", key, item: null, pending: null };
    setMode("edit", "编辑文献");
    openShell();
    setMessage("正在读取 Local API 当前数据…");
    for (const element of itemForm.elements) element.disabled = true;
    try {
      const result = await fetchJson(`/api/zotero/edit/${encodeURIComponent(key)}`);
      if (result.data.status !== "ok" || !result.data.item) throw new Error(result.data.message || "当前文献不可编辑");
      state.zotero.editor.item = result.data.item;
      fillItem(result.data.item);
      setMessage("已读取当前版本。提交前会再次检查版本。");
    } catch (error) {
      setMessage(error.message || "无法读取当前文献。", true);
    } finally {
      for (const element of itemForm.elements) element.disabled = false;
      itemType.disabled = true;
    }
  }

  function openCreateItem() {
    if (!writeEnabled()) return;
    state.zotero.editor = { open: true, mode: "create", key: "", item: null, pending: null };
    setMode("create", "新建文献");
    openShell();
    itemForm.reset();
    itemType.disabled = false;
    itemType.value = "book";
    field("creators").value = "";
    field("tags").value = "";
    field("collections").value = "";
    editorVersion.textContent = "新条目 · 尚无版本";
    setMessage("新条目只会发送你填写的文献元数据。");
  }

  function openCreateCollection() {
    if (!writeEnabled()) return;
    state.zotero.editor = { open: true, mode: "collection", key: "", item: null, pending: null };
    setMode("collection", "新建集合");
    openShell();
    collectionForm.reset();
    setMessage("只会创建集合，不会移动或删除现有内容。");
  }

  function itemBody() {
    const fields = Object.fromEntries(EDITABLE_FIELDS.map((name) => [name, field(name).value.trim()]));
    const body = {
      fields,
      creators: parseCreatorLines(field("creators").value),
      tags: splitLines(field("tags").value).map((tag) => ({ tag, type: 0 })),
      collections: splitLines(field("collections").value)
    };
    if (state.zotero.editor.mode === "edit") {
      body.version = Number(field("version").value);
      body.completeLists = ["creators", "tags", "collections"];
    } else body.itemType = itemType.value;
    return body;
  }

  function itemSummary(body) {
    const title = body.fields.title || "未命名条目";
    if (state.zotero.editor.mode === "create") return `创建 ${body.itemType}：${title}\n作者 ${body.creators.length} 位 · 标签 ${body.tags.length} 个 · 集合 ${body.collections.length} 个`;
    const original = state.zotero.editor.item?.fields || {};
    const changes = EDITABLE_FIELDS.filter((name) => body.fields[name] !== (original[name] || ""));
    return `更新“${title}”\n${changes.length ? `修改字段：${changes.join("、")}\n` : "标量字段无变化\n"}完整替换作者 ${body.creators.length} 位、标签 ${body.tags.length} 个、集合 ${body.collections.length} 个\n提交版本：${body.version}`;
  }

  function queue(pending) {
    state.zotero.editor.pending = pending;
    confirmationSummary.textContent = pending.summary;
    confirmation.classList.remove("hidden");
    setMessage("请核对下面的完整写入摘要。确认后才会请求 Zotero。");
    confirmation.scrollIntoView({ block: "nearest" });
  }

  async function loadStatus() {
    try {
      const result = await fetchJson("/api/zotero/write-status");
      setWriteStatus(result.data);
    } catch (error) {
      setWriteStatus({ status: "offline", authorization: "unavailable", message: error.message });
    }
  }

  async function confirm() {
    const pending = state.zotero.editor.pending;
    if (!pending) return;
    const confirmButton = $('[data-testid="zotero-confirm"]');
    confirmButton.disabled = true;
    try {
      const result = await fetchJson(pending.path, { method: pending.method, headers: { "content-type": "application/json" }, body: JSON.stringify(pending.body) });
      const data = result.data;
      if (!result.response.ok) {
        state.zotero.editor.pending = null;
        confirmation.classList.add("hidden");
        if (result.response.status === 412 || data.status === "conflict") {
          setConflict(true);
          setMessage(data.message || "版本冲突，请重新加载当前数据。", true);
        } else setMessage(data.message || `Zotero 写入失败（HTTP ${result.response.status}）。`, true);
        if (["unauthorized", "denied"].includes(data.status)) await loadStatus();
        return;
      }
      state.zotero.editor.pending = null;
      confirmation.classList.add("hidden");
      setConflict(false);
      setMessage(data.message || "Zotero 写入成功。");
      if (pending.kind === "edit") {
        const nextVersion = Number(data.version);
        if (Number.isInteger(nextVersion)) {
          field("version").value = String(nextVersion);
          editorVersion.textContent = `版本 ${nextVersion}`;
        }
        state.zotero.editor.item = { ...state.zotero.editor.item, version: nextVersion, fields: pending.body.fields, creators: pending.body.creators, tags: pending.body.tags, collections: pending.body.collections };
        await reloadItems();
      } else if (pending.kind === "note") noteForm.reset();
      else {
        await reloadAll();
        if (pending.kind === "collection") close();
      }
      await loadStatus();
    } catch (error) {
      setMessage(error.message || "无法连接 Zotero 回写服务。", true);
    } finally {
      confirmButton.disabled = false;
    }
  }

  async function authorize() {
    setWriteStatus({ status: "loading", authorization: "unknown", message: "正在请求 Zotero 授权…" });
    try {
      const result = await fetchJson("/api/zotero/authorize", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setWriteStatus(result.data);
      if (result.data.status === "authorized") showToast("回写授权已连接；Zotero 的 Always Allow / Allow 选择由你决定。");
      else if (result.data.message) showToast(result.data.message);
    } catch (error) {
      setWriteStatus({ status: "offline", authorization: "unavailable", message: error.message });
    }
  }

  async function forgetAuthorization() {
    try {
      const result = await fetchJson("/api/zotero/forget-authorization", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setWriteStatus(result.data);
      showToast(result.data.message || "已忘记本地授权。");
    } catch (error) {
      showToast(error.message || "无法忘记本地授权。");
    }
  }

  function bind() {
    itemForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!writeEnabled()) return;
      const body = itemBody();
      const edit = state.zotero.editor.mode === "edit";
      queue({ kind: edit ? "edit" : "create", method: edit ? "PATCH" : "POST", path: edit ? `/api/zotero/edit/${encodeURIComponent(state.zotero.editor.key)}` : "/api/zotero/items", body, summary: itemSummary(body) });
    });
    noteForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!writeEnabled() || !state.zotero.editor.key) return;
      const data = new FormData(noteForm);
      const body = { title: String(data.get("title") || "").trim(), note: String(data.get("note") || "").trim() };
      if (!body.note) return showToast("笔记内容不能为空。");
      queue({ kind: "note", method: "POST", path: `/api/zotero/items/${encodeURIComponent(state.zotero.editor.key)}/notes`, body, summary: `为“${state.zotero.editor.item?.fields?.title || state.zotero.editor.key}”添加子笔记\n${body.title ? `标题：${body.title}\n` : ""}内容：${body.note.slice(0, 160)}${body.note.length > 160 ? "…" : ""}` });
    });
    collectionForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!writeEnabled()) return;
      const data = new FormData(collectionForm);
      const body = { name: String(data.get("name") || "").trim() };
      const parentCollection = String(data.get("parentCollection") || "").trim();
      if (parentCollection) body.parentCollection = parentCollection;
      if (!body.name) return showToast("集合名称不能为空。");
      queue({ kind: "collection", method: "POST", path: "/api/zotero/collections", body, summary: `创建集合：${body.name}${parentCollection ? `\n父集合 key：${parentCollection}` : ""}` });
    });
    panel.addEventListener("click", async (event) => {
      const element = event.target.closest("[data-action]");
      const action = element?.dataset.action;
      if (action === "zotero-authorize") await authorize();
      if (action === "zotero-forget") await forgetAuthorization();
      if (action === "zotero-open-editor") await open(element.dataset.zoteroKey);
      if (action === "zotero-create-item") openCreateItem();
      if (action === "zotero-create-collection") openCreateCollection();
      if (action === "zotero-close-editor") close();
      if (action === "zotero-confirm") await confirm();
      if (action === "zotero-cancel-confirm") {
        state.zotero.editor.pending = null;
        confirmation.classList.add("hidden");
        setMessage("已返回修改，尚未请求 Zotero。");
      }
      if (action === "zotero-reload-editor" && state.zotero.editor.key) await open(state.zotero.editor.key);
    });
  }

  return { bind, loadStatus, setWriteStatus, updateControls };
}
