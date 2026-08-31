import { createZoteroBrowser } from "./browser.js";
import { createZoteroEditor } from "./editor.js";

export function createZoteroFeature({ state, $, setScopedState, showToast }) {
  const panel = $('[data-module-panel="zotero"]');
  let browser;

  async function fetchJson(url, options = {}) {
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

  const editor = createZoteroEditor({
    state, $, panel, showToast, fetchJson,
    reloadItems: () => loadItems(),
    reloadAll: () => load()
  });
  browser = createZoteroBrowser({ state, $, panel, setScopedState, updateWriteControls: editor.updateControls });

  function itemsUrl() {
    const params = new URLSearchParams({ limit: String(state.zotero.limit), offset: String(state.zotero.offset) });
    if (state.zotero.q) params.set("q", state.zotero.q);
    if (state.zotero.collection) params.set("collection", state.zotero.collection);
    return `/api/zotero/items?${params.toString()}`;
  }

  async function loadItems(requestId = ++state.zotero.requestId) {
    browser.itemList.setAttribute("aria-busy", "true");
    try {
      const { data } = await fetchJson(itemsUrl());
      if (requestId !== state.zotero.requestId) return;
      if (data.status === "disconnected") {
        state.zotero.items = [];
        state.zotero.total = 0;
        browser.setState("disconnected", data.message);
        return;
      }
      state.zotero.items = Array.isArray(data.items) ? data.items : [];
      state.zotero.total = Number(data.total) || 0;
      state.zotero.limit = Number(data.limit) || state.zotero.limit;
      state.zotero.offset = Number(data.offset) || 0;
      state.zotero.hasMore = Boolean(data.hasMore);
      browser.renderItems();
      if (state.zotero.items.length) browser.setState("connected");
      else browser.setState("empty", state.zotero.q || state.zotero.collection ? "没有符合当前搜索或集合筛选的文献。" : (data.message || "还没有可显示的文献。"));
    } catch (error) {
      if (requestId !== state.zotero.requestId) return;
      state.zotero.items = [];
      state.zotero.total = 0;
      browser.setState("error", `无法连接到文献服务：${error.message}`);
    } finally {
      if (requestId === state.zotero.requestId) browser.itemList.removeAttribute("aria-busy");
    }
  }

  async function load() {
    const requestId = ++state.zotero.requestId;
    state.zotero.initialized = true;
    state.zotero.items = [];
    state.zotero.total = 0;
    browser.setState("loading");
    try {
      const [statusResult, collectionResult, writeResult] = await Promise.all([
        fetchJson("/api/zotero/status"),
        fetchJson("/api/zotero/collections"),
        fetchJson("/api/zotero/write-status")
      ]);
      if (requestId !== state.zotero.requestId) return;
      state.zotero.summary = statusResult.data;
      state.zotero.collections = Array.isArray(collectionResult.data.collections) ? collectionResult.data.collections : [];
      editor.setWriteStatus(writeResult.data);
      browser.renderCollections();
      if (statusResult.data.status === "disconnected") {
        browser.setState("disconnected", statusResult.data.message);
        return;
      }
      await loadItems(requestId);
    } catch (error) {
      if (requestId !== state.zotero.requestId) return;
      browser.setState("error", `无法读取本机 Zotero：${error.message}`);
    }
  }

  function bind() {
    browser.bind({ loadItems });
    editor.bind();
    panel.addEventListener("click", async (event) => {
      const element = event.target.closest("[data-action]");
      const action = element?.dataset.action;
      if (action === "zotero-refresh") await load();
      if (action === "zotero-clear") {
        state.zotero.q = "";
        state.zotero.collection = "";
        state.zotero.offset = 0;
        browser.searchInput.value = "";
        browser.collectionSelect.value = "";
        browser.renderCollections();
        await loadItems();
      }
      if (action === "zotero-page") {
        if (element.dataset.pageDirection === "next" && state.zotero.hasMore) state.zotero.offset += state.zotero.limit;
        if (element.dataset.pageDirection === "previous") state.zotero.offset = Math.max(0, state.zotero.offset - state.zotero.limit);
        await loadItems();
      }
    });
  }

  return { bind, load };
}
