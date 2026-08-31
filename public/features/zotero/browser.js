import { formatCount, itemDate, typeLabel } from "./format.js";

export function createZoteroBrowser({ state, $, panel, setScopedState, updateWriteControls }) {
  const searchForm = $('[data-testid="zotero-search-form"]');
  const searchInput = $('[data-testid="zotero-search"]');
  const collectionSelect = $('[data-testid="zotero-collection-filter"]');
  const collectionList = $('[data-testid="zotero-collection-list"]');
  const itemList = $('[data-testid="zotero-item-list"]');
  const pagination = $('[data-testid="zotero-pagination"]');

  function updateMetrics() {
    const counts = state.zotero.summary?.counts || {};
    const available = Boolean(state.zotero.summary) && !["disconnected", "error"].includes(state.zotero.status);
    for (const [testId, key] of [["zotero-item-count", "items"], ["zotero-collection-count", "collections"], ["zotero-attachment-count", "attachments"], ["zotero-note-count", "notes"], ["zotero-collection-count-label", "collections"]]) {
      $(`[data-testid="${testId}"]`).textContent = available ? formatCount(counts[key]) : "—";
    }
  }

  function setState(responseStatus, message = "") {
    state.zotero.status = responseStatus;
    setScopedState(panel, "data-zotero-state", responseStatus, message);
    const labels = { connected: "已连接 · 本地库", empty: "暂无匹配", disconnected: "未连接", error: "读取失败", loading: "连接中…" };
    $('[data-testid="zotero-connection-status"]').textContent = labels[responseStatus] || "读取中…";
    updateMetrics();
    const connected = responseStatus === "connected";
    itemList.classList.toggle("hidden", !connected);
    pagination.classList.toggle("hidden", !connected || state.zotero.total === 0);
    for (const element of searchForm.elements) element.disabled = ["loading", "disconnected", "error"].includes(responseStatus);
    updateWriteControls();
  }

  function collectionButton(value, label, depth = 0, itemCount = null) {
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

  function renderCollections() {
    const allCount = Number(state.zotero.summary?.counts?.items) || 0;
    const buttons = [collectionButton("", "全部文献", 0, allCount)];
    const options = [new Option(`全部文献 · ${formatCount(allCount)}`, "")];
    for (const collection of state.zotero.collections) {
      const value = collection.key || String(collection.id);
      buttons.push(collectionButton(value, collection.name, collection.depth, collection.itemCount));
      const indent = collection.depth ? `${"　".repeat(collection.depth)} ` : "";
      options.push(new Option(`${indent}${collection.name} · ${formatCount(collection.itemCount)}`, value));
    }
    collectionList.replaceChildren(...buttons);
    collectionSelect.replaceChildren(...options);
    collectionSelect.value = state.zotero.collection;
  }

  function itemCard(item) {
    const card = document.createElement("article");
    card.className = "zotero-item-card";
    card.dataset.zoteroItemId = String(item.itemId || item.id || "");
    const top = document.createElement("div");
    top.className = "zotero-item-top";
    const title = document.createElement("h3");
    title.className = "zotero-item-title";
    title.textContent = item.title || "未命名条目";
    const key = document.createElement("code");
    key.className = "zotero-item-key";
    key.textContent = item.key ? `Zotero · ${item.key}` : `ID · ${item.itemId || item.id}`;
    top.append(title, key);
    const meta = document.createElement("div");
    meta.className = "zotero-item-meta";
    for (const text of [item.creatorText || "作者未知", itemDate(item), typeLabel(item.itemType)]) {
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
    const itemTags = item.tags || [];
    if (itemTags.length) {
      const tags = document.createElement("div");
      tags.className = "zotero-tags";
      for (const tag of itemTags.slice(0, 8)) {
        const chip = document.createElement("span");
        chip.className = "zotero-tag";
        chip.textContent = tag;
        tags.append(chip);
      }
      if (itemTags.length > 8) {
        const more = document.createElement("span");
        more.className = "zotero-tag zotero-tag-more";
        more.textContent = `+${itemTags.length - 8}`;
        tags.append(more);
      }
      card.append(tags);
    }
    const footer = document.createElement("div");
    footer.className = "zotero-item-footer";
    const membership = document.createElement("span");
    membership.className = "zotero-membership";
    const names = item.collectionNames?.slice(0, 2) || [];
    const collections = item.collections || [];
    membership.textContent = names.length ? `集合 · ${names.join("、")}${collections.length > names.length ? ` 等 ${collections.length} 个` : ""}` : "未加入集合";
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

  function renderItems() {
    itemList.replaceChildren(...state.zotero.items.map(itemCard));
    const start = state.zotero.total ? state.zotero.offset + 1 : 0;
    const end = state.zotero.offset + state.zotero.items.length;
    $('[data-testid="zotero-page-label"]').textContent = state.zotero.total ? `${formatCount(start)}–${formatCount(end)} / ${formatCount(state.zotero.total)}` : "0 / 0";
    $('[data-testid="zotero-previous"]').disabled = state.zotero.offset <= 0;
    $('[data-testid="zotero-next"]').disabled = !state.zotero.hasMore;
  }

  function bind({ loadItems }) {
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      state.zotero.q = searchInput.value.trim().slice(0, 200);
      state.zotero.offset = 0;
      void loadItems();
    });
    collectionSelect.addEventListener("change", () => {
      state.zotero.collection = collectionSelect.value;
      state.zotero.offset = 0;
      renderCollections();
      void loadItems();
    });
    panel.addEventListener("click", async (event) => {
      const collection = event.target.closest("[data-zotero-collection]");
      if (!collection) return;
      state.zotero.collection = collection.dataset.zoteroCollection || "";
      state.zotero.offset = 0;
      collectionSelect.value = state.zotero.collection;
      renderCollections();
      await loadItems();
    });
  }

  return { bind, itemList, renderCollections, renderItems, searchInput, collectionSelect, setState };
}
