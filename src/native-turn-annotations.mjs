import { selectAnnotationReadingTurn, readAnnotationReadingTurn } from './annotation-reading-turn.mjs';
import { createNativeTurnNavigation } from './native-turn-navigation.mjs';
import { readNativeTurnPreview } from './native-turn-rail-preview.mjs';
import { readNativeAnnotationContext } from './native-turn-annotation-adapter.mjs';
import { TURN_ANNOTATION_STYLE } from './native-turn-annotation-style.mjs';
export function installNativeTurnAnnotations(readContext, css, createNavigation = () => ({ update() {}, dispose() {}, contains() { return false; } }), readPreview, readingTurn = () => null) {
  const VERSION = '2026-09-06.14', KEY = 'codex-control-console.annotation-drafts.v1';
  if (window.__codexControlConsoleAnnotations?.version === VERSION) return;
  window.__codexControlConsoleAnnotations?.dispose();
  let pending = [], storageError = '', context = null, selected = '', notes = {}, loadedThread = '', error = '', signature = '', disposed = false, scheduled = false, layout = null, hover = null;
  let followScroll = false, composing = false, scrollSequence = 0;
  let expanded = true;
  try { expanded = localStorage.getItem(KEY + '.open') !== 'false'; } catch { /* optional presentation */ }
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(saved)) pending = saved; } catch { storageError = '草稿读取失败'; }
  const make = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  const style = make('style'); style.textContent = css; document.head.append(style);
  const panel = make('aside'); panel.setAttribute('data-ccc-annotations', ''); panel.setAttribute('aria-label', '会话批注');
  const header = make('header'), close = make('button', '−');
  close.setAttribute('data-ccc-annotation-collapse', ''); close.setAttribute('aria-label', '收起批注'); close.title = '收起批注';
  header.append(make('span', '批注'), close);
  const label = make('label', '对应轮次'), select = make('select'); select.setAttribute('aria-label', '批注对应轮次'); label.append(select);
  const jump = make('button', '定位这一轮');
  const editor = make('textarea'); editor.placeholder = '记录这一轮的想法…'; editor.maxLength = 20000; editor.setAttribute('aria-label', '轮次批注');
  const status = make('small'); status.setAttribute('role', 'status');
  const hint = make('small', '自动保存 · 仅记录在本机，不发送给模型');
  panel.append(header, label, jump, editor, status, hint);
  const toggle = make('button', '批注'); toggle.setAttribute('data-ccc-annotation-toggle', ''); toggle.setAttribute('aria-label', '打开批注面板');
  const preview = make('div'); preview.setAttribute('data-ccc-annotation-preview', ''); preview.setAttribute('role', 'tooltip'); preview.hidden = true;
  const previewText = make('div'); preview.append(make('strong', '批注'), previewText);
  document.body.append(panel, toggle, preview);
  const navigation = createNavigation({ document, window, getNote: note, selectTurn: choose, readPreview, getReadingTurn: readingTurn });
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(pending)); storageError = ''; } catch { storageError = '草稿未能保存在浏览器，请勿关闭窗口'; } }
  function note(id) { return pending.find(x => x.threadId === context?.threadId && x.turnId === id)?.text ?? notes[id]?.text ?? ''; }
  function choose(id, manual = true) { if (manual) { scrollSequence++; followScroll = false; } selected = id; editor.value = note(id); select.value = id; updateStatus(); }
  function updateStatus() {
    const dirty = pending.some(x => x.threadId === context?.threadId && x.turnId === selected);
    status.textContent = storageError || error || (dirty ? '正在保存…' : loadedThread === context?.threadId ? '已保存' : '正在读取…');
    editor.disabled = !selected || (loadedThread !== context?.threadId && !dirty);
  }
  function setExpanded(value) { expanded = value; try { localStorage.setItem(KEY + '.open', String(value)); } catch {} refresh(); }
  close.addEventListener('click', () => setExpanded(false)); toggle.addEventListener('click', () => setExpanded(true));
  select.addEventListener('change', () => choose(select.value));
  jump.addEventListener('click', () => { const turn = context?.turns.find(x => x.id === selected); if (turn?.markers[0]) turn.markers[0].click(); else turn?.anchor?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  editor.addEventListener('keydown', event => event.stopPropagation());
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; if (followScroll) schedule(); });
  editor.addEventListener('input', () => {
    if (!context || !selected) return;
    pending = pending.filter(x => x.threadId !== context.threadId || x.turnId !== selected);
    pending.push({ threadId: context.threadId, turnId: selected, text: editor.value, requestId: crypto.randomUUID(), editedAt: Date.now() });
    persist(); updateStatus(); decorate(); navigation.update(context, outputCard);
  });
  function decorate() {
    const marked = new Set();
    for (const turn of context?.turns || []) for (const marker of turn.markers) {
      if (note(turn.id).trim()) { marked.add(marker); if (!marker.hasAttribute('data-ccc-annotated')) marker.setAttribute('data-ccc-annotated', ''); }
    }
    document.querySelectorAll('[data-ccc-annotated]').forEach(marker => { if (!marked.has(marker)) marker.removeAttribute('data-ccc-annotated'); });
  }
  let previewHost = null;
  function releasePreviewHost() {
    previewHost?.removeAttribute('data-ccc-annotation-preview-host');
    previewHost?.style.removeProperty('--ccc-annotation-height');
    previewHost = null;
  }
  function placePreview() {
    const text = hover && note(hover.turnId);
    const native = document.querySelector('[data-thread-user-message-navigation-tooltip-preview]');
    if (!text?.trim() || !hover.marker.isConnected || !native) { preview.hidden = true; releasePreviewHost(); return; }
    previewText.textContent = text.slice(0, 800);
    preview.className = native.className;
    const bounds = native.getBoundingClientRect();
    preview.style.width = bounds.width + 'px';
    preview.hidden = false;
    const height = Math.ceil(preview.getBoundingClientRect().height) + 4 + 'px';
    if (previewHost !== native || native.style.getPropertyValue('--ccc-annotation-height') !== height) {
      if (previewHost !== native) releasePreviewHost();
      previewHost = native; native.setAttribute('data-ccc-annotation-preview-host', '');
      native.style.setProperty('--ccc-annotation-height', height);
      // Let the native floating container reposition for the combined card height.
      setTimeout(() => { if (!disposed) placePreview(); }, 60);
    }
    preview.style.left = bounds.left + 'px';
    preview.style.top = bounds.bottom + 4 + 'px';
  }

  function markerAt(target) { return target?.closest?.('[data-thread-user-message-navigation-item-id]'); }
  function showPreview(event) {
    const marker = markerAt(event.target); if (!marker) return;
    const turn = context?.turns.find(turn => turn.markers.includes(marker));
    hover = turn ? { marker, turnId: turn.id } : null; placePreview();
  }
  function hidePreview(event) { if (markerAt(event.target) && !markerAt(event.relatedTarget)) { hover = null; preview.hidden = true; releasePreviewHost(); } }
  function selectMarker(event) {
    const marker = markerAt(event.target), turn = context?.turns.find(turn => turn.markers.includes(marker));
    if (turn) choose(turn.id);
  }
  const listeners = [['pointerover', showPreview], ['focusin', showPreview], ['pointerout', hidePreview], ['focusout', hidePreview], ['click', selectMarker]];
  listeners.forEach(([type, listener]) => document.addEventListener(type, listener, true));
  let outputCard = null;
  function releaseOutputCard() {
    outputCard?.removeAttribute('data-ccc-annotation-output-host');
    outputCard?.style.removeProperty('--ccc-annotation-output-limit');
    outputCard = null;
  }
  function positionCard() {
    const heading = Array.from(document.querySelectorAll('button')).find(button =>
      ['输出内容', '来源', 'Outputs', 'Sources'].includes(button.textContent?.trim()) && button.getBoundingClientRect().width > 0);
    const card = heading?.closest('[class*="rounded-3xl"][class*="bg-surface-elevated-secondary"]');
    if (outputCard !== card) { releaseOutputCard(); outputCard = card || null; }
    const target = expanded ? panel : toggle;
    if (!context || !card) {
      releaseOutputCard();
      panel.className = ''; toggle.className = '';
      for (const element of [panel, toggle]) for (const key of ['left', 'top', 'width', 'height', 'background', 'borderRadius', 'boxShadow', 'color']) element.style[key] = '';
      return false;
    }
    if (expanded) {
      const limit = Math.max(100, window.innerHeight - card.getBoundingClientRect().top - 300 - 28);
      card.setAttribute('data-ccc-annotation-output-host', '');
      card.style.setProperty('--ccc-annotation-output-limit', limit + 'px');
    } else { card.removeAttribute('data-ccc-annotation-output-host'); card.style.removeProperty('--ccc-annotation-output-limit'); }
    const bounds = card.getBoundingClientRect(), appearance = getComputedStyle(card);
    target.className = card.className;
    Object.assign(target.style, { left: bounds.left + 'px', top: bounds.bottom + 12 + 'px', width: bounds.width + 'px',
      height: expanded ? Math.max(160, Math.min(420, window.innerHeight - bounds.bottom - 28)) + 'px' : '40px',
      background: appearance.backgroundColor, borderRadius: appearance.borderRadius, boxShadow: appearance.boxShadow, color: appearance.color });
    return true;
  }
  function refresh() {
    if (disposed) return;
    const next = readContext(document);
    if (next?.threadId !== context?.threadId) { scrollSequence++; followScroll = false; context = next; notes = {}; loadedThread = ''; selected = ''; signature = ''; error = ''; hover = null; editor.value = ''; }
    else context = next;
    panel.hidden = !context || !expanded; toggle.hidden = !context || expanded;
    const attached = positionCard();
    const newLayout = context && expanded && !attached && window.innerWidth > 850 ? context.host : null;
    if (layout !== newLayout) { layout?.removeAttribute('data-ccc-annotation-layout'); layout = newLayout; layout?.setAttribute('data-ccc-annotation-layout', ''); }
    if (!context) { decorate(); preview.hidden = true; releasePreviewHost(); navigation.update(null, null); return; }
    const ids = context.turns.map(turn => turn.id);
    const nextSignature = JSON.stringify([context.threadId, ids]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      select.replaceChildren(...ids.map((id, index) => { const option = make('option', '第 ' + (index + 1) + ' 轮'); option.value = id; return option; }));
      if (!ids.includes(selected)) selected = readingTurn(context) || context.turns.find(turn => turn.markers.some(marker => marker.getAttribute('aria-current') === 'true'))?.id || ids.at(-1) || '';
      choose(selected, false);
    }
    if (followScroll && !composing) {
      followScroll = false;
      const current = readingTurn(context);
      if (current && current !== selected && ids.includes(current)) choose(current, false);
    }
    updateStatus(); decorate(); placePreview(); navigation.update(context, outputCard);
  }
  function schedule() { if (scheduled || disposed) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; refresh(); }); }
  const observer = new MutationObserver(records => { if (records.some(r => !panel.contains(r.target) && !preview.contains(r.target) && !navigation.contains(r.target))) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  function onTimelineScroll(event) {
    const scroll = context?.content?.closest('[data-app-action-timeline-scroll]');
    if (!scroll || event.target !== scroll) return;
    followScroll = true; schedule();
    const sequence = ++scrollSequence;
    for (const delay of [120, 400, 900]) setTimeout(() => {
      if (disposed || sequence !== scrollSequence) return;
      followScroll = true; schedule();
    }, delay);
  }
  document.addEventListener('scroll', onTimelineScroll, { passive: true, capture: true });
  window.addEventListener('resize', schedule);
  const timer = setInterval(schedule, 1000);
  window.__codexControlConsoleAnnotations = {
    version: VERSION,
    packet() { return { threadId: context?.threadId || null, actions: pending.filter(x => Date.now() - (x.editedAt || 0) >= 500).slice(0, 20) }; },
    accept(value) {
      const acknowledgements = new Set(value.acknowledged || []); pending = pending.filter(x => !acknowledgements.has(x.requestId)); persist();
      if (value.threadId === context?.threadId) {
        const wasDirty = document.activeElement === editor;
        if (value.notes) { notes = value.notes; loadedThread = value.threadId; }
        error = value.error || '';
        if (!wasDirty) editor.value = note(selected);
      }
      refresh();
    },
    dispose() { disposed = true; navigation.dispose(); releasePreviewHost(); releaseOutputCard(); observer.disconnect(); clearInterval(timer); window.removeEventListener('resize', schedule); document.removeEventListener('scroll', onTimelineScroll, true); listeners.forEach(([type, listener]) => document.removeEventListener(type, listener, true)); layout?.removeAttribute('data-ccc-annotation-layout'); document.querySelectorAll('[data-ccc-annotated]').forEach(x => x.removeAttribute('data-ccc-annotated')); panel.remove(); toggle.remove(); preview.remove(); style.remove(); }
  };
  refresh();
}
export function buildNativeTurnAnnotationsScript() {
  return `(${installNativeTurnAnnotations.toString()})(${readNativeAnnotationContext.toString()},${JSON.stringify(TURN_ANNOTATION_STYLE)},${createNativeTurnNavigation.toString()},${readNativeTurnPreview.toString()},context => (${readAnnotationReadingTurn.toString()})(context,${selectAnnotationReadingTurn.toString()}))`;
}
