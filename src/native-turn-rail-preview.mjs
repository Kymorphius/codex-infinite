export function readNativeTurnPreview(turn, request = false) {
  const text = value => typeof value === 'string' ? value.trim().slice(0, 6000) : '';
  let props = null;
  for (const marker of turn.markers || []) {
    let fiber = marker[Object.keys(marker).find(key => key.startsWith('__reactFiber'))];
    for (let i = 0; fiber && i < 30; i++, fiber = fiber.return) {
      if (Array.isArray(fiber.memoizedProps?.items) && fiber.memoizedProps.items.some(item => String(item?.id || '').split(':')[0] === turn.id)) { props = fiber.memoizedProps; break; }
    }
    if (props) break;
  }
  const prompts = [], responses = [];
  let state = '';
  for (const item of (props?.items || []).filter(item => String(item?.id || '').split(':')[0] === turn.id).slice(0, 40)) {
    if (request && typeof props.onPreviewItem === 'function') {
      try { Promise.resolve(props.onPreviewItem(item)).catch(() => {}); } catch { /* unavailable reader */ }
    }
    try {
      const prompt = text(item.getLabel?.()), response = text(item.getPreview?.()?.response);
      if (prompt && !prompts.includes(prompt)) prompts.push(prompt);
      if (response && !responses.includes(response)) responses.push(response);
      if (item.previewState === 'loading' || item.previewState === 'unavailable') state = item.previewState;
    } catch { state = 'unavailable'; }
  }
  if (!prompts.length && turn.anchor) {
    for (const node of turn.anchor.querySelectorAll('[data-user-message-bubble]')) { const prompt = text(node.textContent); if (prompt && !prompts.includes(prompt)) prompts.push(prompt); }
  }
  if (!responses.length && turn.anchor) {
    // Native rendered prose only; never include tool execution bodies in a preview.
    for (const node of turn.anchor.querySelectorAll('[data-message-author-role="assistant"],.markdown')) {
      if (node.closest('[data-user-message-bubble]')) continue;
      const response = text(node.textContent); if (response && !responses.includes(response)) responses.push(response);
    }
  }
  return { prompt: prompts.join('\n').slice(0, 1600), response: responses.join('\n').slice(0, 2400), state };
}
