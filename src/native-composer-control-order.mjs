export const NATIVE_COMPOSER_CONTROL_ORDER_KEY = "codex-control-console.composer-control-order.v1";
export const NATIVE_COMPOSER_CONTROL_IDS = ["save", "claim", "context", "routing"];

export function normalizeNativeComposerControlOrder(value) {
  const seen = new Set(), ordered = [];
  for (const id of Array.isArray(value) ? value : []) if (NATIVE_COMPOSER_CONTROL_IDS.includes(id) && !seen.has(id)) { seen.add(id); ordered.push(id); }
  for (const id of NATIVE_COMPOSER_CONTROL_IDS) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

export function reorderNativeComposerControlOrder(order, sourceId, targetId, after = false) {
  const next = normalizeNativeComposerControlOrder(order);
  if (!NATIVE_COMPOSER_CONTROL_IDS.includes(sourceId) || !NATIVE_COMPOSER_CONTROL_IDS.includes(targetId) || sourceId === targetId) return next;
  next.splice(next.indexOf(sourceId), 1);
  next.splice(next.indexOf(targetId) + (after ? 1 : 0), 0, sourceId);
  return next;
}

export function buildNativeComposerControlOrderSource() {
  return `${normalizeNativeComposerControlOrder.toString()}
  ${reorderNativeComposerControlOrder.toString()}
  const NATIVE_COMPOSER_CONTROL_ORDER_KEY = ${JSON.stringify(NATIVE_COMPOSER_CONTROL_ORDER_KEY)};
  const NATIVE_COMPOSER_CONTROL_IDS = ${JSON.stringify(NATIVE_COMPOSER_CONTROL_IDS)};
  const createNativeComposerControlOrder = () => {
    const controls = [['save', '[data-ccc-save-draft-todo]'], ['claim', '[data-ccc-claim-task]'], ['context', '[data-codex-control-console-context-toggle]'], ['routing', '[data-codex-control-console-native-jev-current]']];
    const selector = controls.map(([, value]) => value).join(',');
    let order = normalizeNativeComposerControlOrder((() => { try { return JSON.parse(localStorage.getItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY) || '[]'); } catch { return []; } })()), dragging = null, scheduled = false;
    const idFor = (node) => controls.find(([, value]) => node?.matches?.(value))?.[0] || null;
    const controlFor = (node) => node?.closest?.(selector) || null;
    const persist = () => { try { localStorage.setItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY, JSON.stringify(order)); } catch {} };
    const clearMarkers = () => document.querySelectorAll(selector).forEach((node) => { node.removeAttribute('data-ccc-control-drag-armed'); node.removeAttribute('data-ccc-control-dragging'); node.removeAttribute('data-ccc-control-drop-position'); node.draggable = false; });
    const apply = () => controls.forEach(([id, value]) => { const node = document.querySelector(value), expected = String(order.indexOf(id) + 1); if (node && node.style.order !== expected) node.style.order = expected; });
    const scheduleApply = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; apply(); }); };
    const reorder = (sourceId, targetId, after = false) => { const next = reorderNativeComposerControlOrder(order, sourceId, targetId, after); if (next.join('|') === order.join('|')) return order; order = next; persist(); apply(); return order; };
    const onPointerDown = (event) => { const control = controlFor(event.target); if (!control || (!event.metaKey && !event.ctrlKey)) return; control.draggable = true; control.setAttribute('data-ccc-control-drag-armed', ''); };
    const onDragStart = (event) => { const control = controlFor(event.target), id = idFor(control); if (!control || !id || !control.hasAttribute('data-ccc-control-drag-armed')) return; dragging = id; control.setAttribute('data-ccc-control-dragging', ''); try { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); } catch {} };
    const onDragOver = (event) => { const target = controlFor(event.target), targetId = idFor(target); if (!dragging || !targetId || targetId === dragging) return; event.preventDefault(); try { event.dataTransfer.dropEffect = 'move'; } catch {} const rect = target.getBoundingClientRect(), after = event.clientX > rect.left + rect.width / 2; document.querySelectorAll(selector + '[data-ccc-control-drop-position]').forEach((node) => node.removeAttribute('data-ccc-control-drop-position')); target.setAttribute('data-ccc-control-drop-position', after ? 'after' : 'before'); };
    const onDrop = (event) => { const target = controlFor(event.target), targetId = idFor(target); if (!dragging || !targetId || targetId === dragging) return; event.preventDefault(); reorder(dragging, targetId, target.getAttribute('data-ccc-control-drop-position') === 'after'); clearMarkers(); dragging = null; };
    const onDragEnd = () => { clearMarkers(); dragging = null; };
    document.addEventListener('pointerdown', onPointerDown, true); document.addEventListener('dragstart', onDragStart, true); document.addEventListener('dragover', onDragOver, true); document.addEventListener('drop', onDrop, true); document.addEventListener('dragend', onDragEnd, true);
    const observer = new MutationObserver((records) => { if (records.some((record) => record.type === 'attributes' || [...record.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))))) scheduleApply(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }); apply();
    return { apply, order: () => [...order], reorder, reset: () => { order = normalizeNativeComposerControlOrder([]); try { localStorage.removeItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY); } catch {} apply(); return order; }, dispose: () => { observer.disconnect(); document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('dragstart', onDragStart, true); document.removeEventListener('dragover', onDragOver, true); document.removeEventListener('drop', onDrop, true); document.removeEventListener('dragend', onDragEnd, true); clearMarkers(); } };
  };
  window.__codexControlConsoleComposerControlOrder?.dispose?.(); window.__codexControlConsoleComposerControlOrder = createNativeComposerControlOrder();`;
}
