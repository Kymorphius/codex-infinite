// Keep the latest turn anchored during an explicit route change, including native restoration.
export function createNativeLatestNavigation(documentRef, windowRef) {
  const routeSelector = '[data-above-composer-conversation-id]';
  const contentSelector = '[data-thread-user-message-navigation-content]';
  const scrollSelector = '[data-app-action-timeline-scroll]';
  const intentEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const now = () => windowRef.performance?.now?.() ?? Date.now();
  const mountedId = () => Array.from(documentRef.querySelectorAll(routeSelector)).at(-1)?.getAttribute('data-above-composer-conversation-id') || '';
  let target = '', startedAt = 0, timer = null, seenTarget = false;

  function cancel() {
    if (timer !== null) windowRef.clearInterval(timer);
    timer = null; target = ''; seenTarget = false;
    for (const type of intentEvents) documentRef.removeEventListener(type, cancel, true);
    documentRef.removeEventListener('scroll', onScroll, true);
  }

  function tick(event) {
    if (!target) return;
    const time = now(), age = time - startedAt;
    if (age > 4500) { cancel(); return; }
    if (mountedId() !== target) { if (seenTarget) cancel(); return; }
    seenTarget = true;
    const content = documentRef.querySelector(contentSelector);
    const scroll = content?.closest(scrollSelector);
    if (!scroll || !content.querySelector('[data-turn-key]')) return;
    if (event && event.target !== scroll) return;
    const reversed = scroll.classList?.contains('flex-col-reverse') || windowRef.getComputedStyle?.(scroll)?.flexDirection === 'column-reverse';
    const distance = reversed ? -scroll.scrollTop : scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    if (distance > 80) scroll.scrollTop = reversed ? 0 : Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  }

  function onScroll(event) { tick(event); }

  function request(id) {
    cancel();
    if (!id || mountedId() === id) return false;
    target = id; startedAt = now();
    for (const type of intentEvents) documentRef.addEventListener(type, cancel, true);
    documentRef.addEventListener('scroll', onScroll, true);
    timer = windowRef.setInterval(tick, 120);
    return true;
  }

  return { request, cancel, snapshot: () => ({ pendingId: target, active: timer !== null }) };
}
