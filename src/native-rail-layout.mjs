// The native rail renders only when the content's left gutter is >= 48px.
export function nativeRailContentLimit(scrollWidth, shiftedLeft) {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(shiftedLeft)) return null;
  const limit = Math.floor(scrollWidth - 2 * (52 - shiftedLeft));
  return limit >= 360 ? limit : null;
}
export function createNativeRailGutter(limitFor) {
  let content = null, original = '', priority = '', applied = '';
  function release() {
    if (content && content.style.getPropertyValue('max-width') === applied) {
      if (original) content.style.setProperty('max-width', original, priority);
      else content.style.removeProperty('max-width');
    }
    content = null; applied = '';
  }
  return {
    update(next, scroll) {
      if (content !== next) { release(); content = next; original = next?.style.getPropertyValue('max-width') || ''; priority = next?.style.getPropertyPriority('max-width') || ''; }
      if (!next || !scroll) { release(); return; }
      const bounds = scroll.getBoundingClientRect(), parent = next.parentElement?.getBoundingClientRect();
      const scale = scroll.offsetWidth > 0 ? bounds.width / scroll.offsetWidth : 1;
      const limit = limitFor(bounds.width / scale, ((parent?.left ?? bounds.left) - bounds.left) / scale);
      if (limit === null) { release(); return; }
      const value = `min(var(--thread-content-max-width, 768px), ${limit}px)`;
      if (next.style.getPropertyValue('max-width') !== value) next.style.setProperty('max-width', value, 'important');
      applied = value;
    },
    dispose: release
  };
}
