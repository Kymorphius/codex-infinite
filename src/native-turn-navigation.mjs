export function createNativeTurnNavigation({ document, window, getNote, selectTurn, readPreview, getReadingTurn = value => value.turns.find(turn => turn.markers.some(marker => marker.getAttribute('aria-current') === 'true'))?.id }) {
  const ROOT = 'data-ccc-turn-rail', RIGHT = 'data-ccc-message-rail-right';
  const CARD = 'w-80 max-w-[calc(100vw-1rem)] rounded-xl bg-surface-elevated-secondary/95 p-2 text-sm leading-5 text-default shadow-xl-spread ring-[0.5px] ring-border backdrop-blur-sm';
  const make = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const rail = make('nav'); rail.setAttribute(ROOT, ''); rail.setAttribute('aria-label', '会话轮次');
  const popup = make('div'); popup.setAttribute('data-ccc-turn-rail-preview', ''); popup.setAttribute('role', 'tooltip'); popup.hidden = true;
  const summary = make('div'); summary.className = CARD;
  const title = make('strong'), prompt = make('div'), response = make('div'); summary.append(title, prompt, response);
  const annotation = make('div'); annotation.className = CARD; annotation.setAttribute('data-ccc-turn-note-card', '');
  const noteText = make('div'); annotation.append(make('strong', '批注'), noteText); popup.append(summary, annotation);
  const style = make('style'); style.textContent = `
[${RIGHT}]{left:auto!important;right:var(--ccc-message-rail-inset,12px)!important}
[${ROOT}]{position:fixed;z-index:41;width:36px;display:flex;flex-direction:column;max-height:70vh;overflow-y:auto;scrollbar-width:none;box-sizing:border-box;padding:0;mask-image:linear-gradient(to bottom,var(--ccc-rail-fade-top,black),black 20px,black calc(100% - 20px),var(--ccc-rail-fade-bottom,black));transform:translateY(-50%);-webkit-app-region:no-drag}
[${ROOT}][hidden],[data-ccc-turn-rail-preview][hidden],[data-ccc-turn-note-card][hidden]{display:none!important}
[${ROOT}] button{width:36px;height:var(--ccc-turn-tick-height,12px);flex-shrink:0;display:flex;align-items:center;cursor:pointer;border:0;padding:0;background:transparent;outline-offset:2px}
[${ROOT}] button span{height:2px;width:12px;border-radius:2px;background:color-mix(in srgb,var(--color-text,#ddd) 30%,transparent);transition:width .12s}
[${ROOT}] button[aria-current=true] span{width:18px;background:var(--color-text,#eee)}
[${ROOT}] button:not([aria-current=true]):hover span,[${ROOT}] button:not([aria-current=true]):focus-visible span{width:14px}
[${ROOT}] button[data-annotated] span{background:#a78bfa}
[data-ccc-turn-rail-preview]{position:fixed;z-index:2147483100;display:flex;flex-direction:column;gap:4px;pointer-events:none;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:hidden}
[data-ccc-turn-rail-preview] strong{display:block;font-weight:500;margin-bottom:4px}
[data-ccc-turn-rail-preview] div div{white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
[data-ccc-turn-rail-preview] div div+div{margin-top:6px;opacity:.85}
`;
  document.head.append(style); document.body.append(rail, popup);
  let context = null, outputCard = null, nativeRails = new Set(), signature = '', hovered = '', revealSignature = '', disposed = false;
  function clearRight() {
    for (const nav of nativeRails) { nav.removeAttribute(RIGHT); nav.style.removeProperty('--ccc-message-rail-inset'); }
    nativeRails.clear();
  }
  function paint() {
    if (!context || disposed) { rail.hidden = true; popup.hidden = true; clearRight(); return; }
    const scroll = context.content?.closest('[data-app-action-timeline-scroll]') || context.host;
    const rect = scroll?.getBoundingClientRect();
    if (!rect?.width) { rail.hidden = true; popup.hidden = true; return; }
    rail.hidden = !context.turns.length;
    rail.style.left = Math.max(8, rect.left + 12) + 'px';
    const top = Math.max(8, rect.top), bottom = Math.min(window.innerHeight - 8, rect.top + rect.height);
    const tickHeight = 10;
    const capacity = Math.max(1, Math.min(60, Math.floor(Math.min(window.innerHeight * .7, bottom - top - 16) / tickHeight)));
    const visibleCount = Math.min(capacity, context.turns.length);
    const available = Math.max(tickHeight, visibleCount * tickHeight);
    rail.style.top = (top + bottom) / 2 + 'px'; rail.style.maxHeight = available + 'px'; rail.style.height = available + 'px';
    rail.style.setProperty('--ccc-turn-tick-height', tickHeight + 'px');
    const nextRails = new Set(context.turns.flatMap(turn => turn.markers).map(marker => marker.closest('nav')).filter(Boolean));
    for (const nav of nativeRails) if (!nextRails.has(nav)) { nav.removeAttribute(RIGHT); nav.style.removeProperty('--ccc-message-rail-inset'); }
    nativeRails = nextRails;
    for (const nav of nativeRails) {
      const parent = nav.parentElement?.getBoundingClientRect(), output = outputCard?.getBoundingClientRect();
      const inset = parent && output?.width && output.left > rect.left + 100 ? Math.max(12, parent.right - output.left + 8) : 12;
      if (!nav.hasAttribute(RIGHT)) nav.setAttribute(RIGHT, '');
      if (nav.style.getPropertyValue('--ccc-message-rail-inset') !== inset + 'px') nav.style.setProperty('--ccc-message-rail-inset', inset + 'px');
    }
    const currentTurn = getReadingTurn(context);
    for (const button of rail.children) {
      const turn = context.turns.find(turn => turn.id === button.getAttribute('data-ccc-turn-marker'));
      if (!turn) continue;
      const annotated = !!getNote(turn.id).trim();
      if (annotated) button.setAttribute('data-annotated', ''); else button.removeAttribute('data-annotated');
      button.setAttribute('aria-current', String(turn.id === currentTurn));
    }
    const nextReveal = JSON.stringify([context.threadId, currentTurn, context.turns.length, available]);
    if (revealSignature !== nextReveal) {
      revealSignature = nextReveal;
      const index = context.turns.findIndex(turn => turn.id === currentTurn);
      let start = Math.max(0, Math.round((rail.scrollTop || 0) / tickHeight));
      const margin = Math.min(2, Math.floor((visibleCount - 1) / 2));
      if (index >= 0 && index < start + margin) start = index - margin;
      else if (index >= start + visibleCount - margin) start = index - visibleCount + margin + 1;
      start = Math.max(0, Math.min(context.turns.length - visibleCount, start));
      rail.scrollTop = start * tickHeight;
    }
    rail.style.setProperty('--ccc-rail-fade-top', rail.scrollTop > 0 ? 'transparent' : 'black');
    rail.style.setProperty('--ccc-rail-fade-bottom', (rail.scrollTop || 0) + available < context.turns.length * tickHeight - 1 ? 'transparent' : 'black');
    show(false);
  }
  function show(request) {
    const index = context?.turns.findIndex(turn => turn.id === hovered) ?? -1;
    if (index < 0) { popup.hidden = true; return; }
    const turn = context.turns[index], value = readPreview(turn, request), note = getNote(turn.id);
    title.textContent = '第 ' + (index + 1) + ' 轮';
    prompt.textContent = value.prompt || (value.state === 'loading' ? '正在读取摘要…' : '暂无用户消息摘要');
    response.textContent = value.response || (value.state === 'unavailable' ? '该轮回复摘要暂不可用' : '暂无回复摘要');
    noteText.textContent = note.slice(0, 800); annotation.hidden = !note.trim(); popup.hidden = false;
    const button = Array.from(rail.children).find(button => button.getAttribute('data-ccc-turn-marker') === hovered);
    const bounds = button?.getBoundingClientRect(); if (!bounds) return;
    popup.style.left = Math.max(12, Math.min(bounds.right + 8, window.innerWidth - Math.min(320, window.innerWidth - 24) - 12)) + 'px';
    popup.style.top = Math.max(12, Math.min(bounds.top, window.innerHeight - popup.getBoundingClientRect().height - 12)) + 'px';
  }
  const marker = target => target?.closest?.('[data-ccc-turn-marker]');
  const enter = event => { const button = marker(event.target); if (!button) return; hovered = button.getAttribute('data-ccc-turn-marker'); show(true); };
  const leave = event => { if (!rail.contains(event.relatedTarget)) { hovered = ''; popup.hidden = true; } };
  rail.addEventListener('pointerover', enter); rail.addEventListener('focusin', enter);
  rail.addEventListener('pointerout', leave); rail.addEventListener('focusout', leave);
  function reveal(turn) {
    if (!turn) return;
    selectTurn(turn.id);
    if (turn.markers[0]) turn.markers[0].click(); else turn.anchor?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  rail.addEventListener('click', event => reveal(context?.turns.find(turn => turn.id === marker(event.target)?.getAttribute('data-ccc-turn-marker'))));
  let lastWheel = 0;
  rail.addEventListener('wheel', event => {
    if (!context || !event.deltaY) return;
    event.preventDefault(); event.stopPropagation();
    const now = Date.now(); if (now - lastWheel < 120) return; lastWheel = now;
    const index = context.turns.findIndex(turn => turn.id === getReadingTurn(context));
    if (index < 0) return;
    const next = Math.max(0, Math.min(context.turns.length - 1, index + Math.sign(event.deltaY)));
    if (next !== index) reveal(context.turns[next]);
  }, { passive: false });
  document.addEventListener('scroll', paint, { passive: true, capture: true });
  return {
    contains(node) { return rail.contains(node) || popup.contains(node); },
    update(value, card) {
      context = value; outputCard = card;
      const next = JSON.stringify([context?.threadId, context?.turns.map(turn => turn.id)]);
      if (signature !== next) {
        signature = next; hovered = '';
        rail.replaceChildren(...(context?.turns || []).map((turn, index) => {
          const button = make('button'); button.type = 'button'; button.setAttribute('data-ccc-turn-marker', turn.id); button.setAttribute('aria-label', '跳转到第 ' + (index + 1) + ' 轮'); button.append(make('span')); return button;
        }));
      }
      paint();
    },
    dispose() { disposed = true; clearRight(); document.removeEventListener('scroll', paint, true); rail.remove(); popup.remove(); style.remove(); }
  };
}
