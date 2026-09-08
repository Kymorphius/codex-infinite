export function reorderNativeConversationTabs(tabs = [], movingKey = "", targetKey = "", placeAfter = false) {
  const sourceIndex = tabs.findIndex((tab) => tab?.key === movingKey);
  const targetIndex = tabs.findIndex((tab) => tab?.key === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return tabs.slice();
  const ordered = tabs.slice();
  const [moving] = ordered.splice(sourceIndex, 1);
  const remainingTargetIndex = ordered.findIndex((tab) => tab?.key === targetKey);
  ordered.splice(remainingTargetIndex + (placeAfter ? 1 : 0), 0, moving);
  return ordered;
}

export function installNativeConversationTabDragging({ root, state, keyFor, render }) {
  let draggedKey = null;
  let dropTargetKey = null;
  let dropAfter = false;

  function clearDropTarget() {
    root.querySelectorAll("[data-drop-position]").forEach((tab) => tab.removeAttribute("data-drop-position"));
    dropTargetKey = null;
    dropAfter = false;
  }

  function clearDragState() {
    clearDropTarget();
    root.querySelectorAll("[data-dragging]").forEach((tab) => {
      tab.removeAttribute("data-dragging");
      tab.setAttribute("aria-grabbed", "false");
    });
    draggedKey = null;
  }

  function reorder(movingKey, targetKey, placeAfter) {
    const before = state.tabs.map(keyFor).join("\n");
    const keyedTabs = state.tabs.map((tab) => ({ ...tab, key: keyFor(tab) }));
    const next = reorderNativeConversationTabs(keyedTabs, movingKey, targetKey, placeAfter);
    if (next.map((tab) => tab.key).join("\n") === before) return false;
    state.tabs = next.map(({ key, ...tab }) => tab);
    render();
    return true;
  }

  function onDragStart(event) {
    if (event.target.closest("[data-close-key]")) {
      event.preventDefault();
      return;
    }
    const tab = event.target.closest('.ccc-native-tab[draggable="true"][data-tab-key]');
    if (!tab || !root.contains(tab)) {
      event.preventDefault();
      return;
    }
    draggedKey = tab.dataset.tabKey;
    tab.dataset.dragging = "";
    tab.setAttribute("aria-grabbed", "true");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedKey);
    }
  }

  function onDragOver(event) {
    if (!draggedKey) return;
    const target = event.target.closest('.ccc-native-tab[data-tab-key]:not([data-console-tab])');
    if (!target || !root.contains(target) || target.dataset.tabKey === draggedKey) {
      clearDropTarget();
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearDropTarget();
    const bounds = target.getBoundingClientRect();
    dropTargetKey = target.dataset.tabKey;
    dropAfter = event.clientX >= bounds.left + bounds.width / 2;
    target.dataset.dropPosition = dropAfter ? "after" : "before";
  }

  function onDrop(event) {
    if (!draggedKey || !dropTargetKey) return;
    event.preventDefault();
    const movingKey = draggedKey;
    const targetKey = dropTargetKey;
    const placeAfter = dropAfter;
    clearDragState();
    reorder(movingKey, targetKey, placeAfter);
  }

  root.addEventListener("dragstart", onDragStart);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("drop", onDrop);
  root.addEventListener("dragend", clearDragState);

  return {
    reorder,
    destroy() {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("dragend", clearDragState);
      clearDragState();
    }
  };
}
