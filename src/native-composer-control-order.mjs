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
    let order = normalizeNativeComposerControlOrder((() => { try { return JSON.parse(localStorage.getItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY) || '[]'); } catch { return []; } })()), gesture = null, suppressClickUntil = 0, scheduled = false;
    const idFor = (node) => controls.find(([, value]) => node?.matches?.(value))?.[0] || null;
    const controlFor = (node) => node?.closest?.(selector) || null;
    const persist = () => { try { localStorage.setItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY, JSON.stringify(order)); } catch {} };
    const clearMarkers = () => document.querySelectorAll(selector).forEach((node) => { node.removeAttribute('data-ccc-control-drag-armed'); node.removeAttribute('data-ccc-control-dragging'); node.removeAttribute('data-ccc-control-drop-position'); });
    const apply = () => controls.forEach(([id, value]) => { const node = document.querySelector(value), expected = String(order.indexOf(id) + 1); if (!node) return; node.draggable = false; if (node.style.order !== expected) node.style.order = expected; });
    const scheduleApply = () => { if (scheduled) return; scheduled = true; queueMicrotask(() => { scheduled = false; apply(); }); };
    const reorder = (sourceId, targetId, after = false) => { const next = reorderNativeComposerControlOrder(order, sourceId, targetId, after); if (next.join('|') === order.join('|')) return order; order = next; persist(); apply(); return order; };
    const onPointerDown = (event) => { const control = controlFor(event.target), id = idFor(control); if (!control || !id || event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return; gesture = { control, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, initialOrder: [...order], moved: false }; control.setAttribute('data-ccc-control-drag-armed', ''); try { control.setPointerCapture(event.pointerId); } catch {} };
    const onPointerMove = (event) => { if (!gesture || event.pointerId !== gesture.pointerId) return; if (!gesture.moved && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 5) return; gesture.moved = true; event.preventDefault(); event.stopImmediatePropagation(); gesture.control.setAttribute('data-ccc-control-dragging', ''); const underPointer = document.elementFromPoint(event.clientX, event.clientY), target = controlFor(underPointer), targetId = idFor(target); if (!target || !targetId || targetId === gesture.id) return; const rect = target.getBoundingClientRect(), after = event.clientX > rect.left + rect.width / 2; order = reorderNativeComposerControlOrder(order, gesture.id, targetId, after); apply(); };
    const finishGesture = (event, cancelled = false) => { if (!gesture || event.pointerId !== gesture.pointerId) return; const active = gesture; gesture = null; try { active.control.releasePointerCapture(event.pointerId); } catch {} if (active.moved) { event.preventDefault(); event.stopImmediatePropagation(); if (cancelled) { order = active.initialOrder; apply(); } else { persist(); suppressClickUntil = Date.now() + 600; } } clearMarkers(); };
    const onPointerUp = (event) => finishGesture(event);
    const onPointerCancel = (event) => finishGesture(event, true);
    const onClick = (event) => { if (Date.now() > suppressClickUntil || !controlFor(event.target)) return; suppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); };
    document.addEventListener('pointerdown', onPointerDown, true); document.addEventListener('pointermove', onPointerMove, true); document.addEventListener('pointerup', onPointerUp, true); document.addEventListener('pointercancel', onPointerCancel, true); document.addEventListener('click', onClick, true);
    const observer = new MutationObserver((records) => { if (records.some((record) => record.type === 'attributes' || [...record.addedNodes].some((node) => node.nodeType === 1 && (node.matches?.(selector) || node.querySelector?.(selector))))) scheduleApply(); });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }); apply();
    return { apply, order: () => [...order], reorder, reset: () => { order = normalizeNativeComposerControlOrder([]); try { localStorage.removeItem(NATIVE_COMPOSER_CONTROL_ORDER_KEY); } catch {} apply(); return order; }, dispose: () => { observer.disconnect(); document.removeEventListener('pointerdown', onPointerDown, true); document.removeEventListener('pointermove', onPointerMove, true); document.removeEventListener('pointerup', onPointerUp, true); document.removeEventListener('pointercancel', onPointerCancel, true); document.removeEventListener('click', onClick, true); clearMarkers(); } };
  };
  window.__codexControlConsoleComposerControlOrder?.dispose?.(); window.__codexControlConsoleComposerControlOrder = createNativeComposerControlOrder();`;
}
