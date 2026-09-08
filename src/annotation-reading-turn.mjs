// Select the visible turn intersecting the upper third of the reading viewport.
export function selectAnnotationReadingTurn(turns, viewport) {
  if (!viewport || !(viewport.bottom > viewport.top)) return null;
  if (viewport.atEnd && viewport.latestTurnId) return viewport.latestTurnId;
  const line = viewport.top + (viewport.bottom - viewport.top) / 3;
  const visible = turns.filter(turn => Number.isFinite(turn.top) && Number.isFinite(turn.bottom) && turn.bottom > turn.top && turn.bottom > viewport.top && turn.top < viewport.bottom);
  const containing = visible.find(turn => turn.top <= line && turn.bottom > line);
  if (containing) return containing.id;
  if (!visible.length) return null;
  return [...visible].sort((a, b) => Math.min(Math.abs(a.top - line), Math.abs(a.bottom - line)) - Math.min(Math.abs(b.top - line), Math.abs(b.bottom - line)))[0].id;
}
export function readAnnotationReadingTurn(context, selectTurn) {
  if (!context) return null;
  const scroll = context.content?.closest('[data-app-action-timeline-scroll]');
  const rect = scroll?.getBoundingClientRect();
  const geometry = context.turns.flatMap(turn => {
    const bounds = turn.anchor?.getBoundingClientRect();
    return bounds ? [{ id: turn.id, top: bounds.top, bottom: bounds.bottom }] : [];
  });
  const dimensionsKnown = Number.isFinite(scroll?.scrollTop) && Number.isFinite(scroll?.scrollHeight) && scroll?.clientHeight > 0;
  const reversed = scroll?.classList?.contains('flex-col-reverse') || (typeof getComputedStyle === 'function' && scroll && getComputedStyle(scroll).flexDirection === 'column-reverse');
  const atEnd = dimensionsKnown && (reversed ? scroll.scrollTop >= -2 : scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 2);
  const viewport = rect ? { top: rect.top, bottom: rect.bottom, atEnd, latestTurnId: context.turns.at(-1)?.id } : null;
  return selectTurn(geometry, viewport) || context.turns.find(turn => turn.markers.some(marker => marker.getAttribute('aria-current') === 'true'))?.id || null;
}
