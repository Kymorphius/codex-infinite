const IMAGE_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-7]$/i;

export function normalizeChecklistInput(value) {
  if (!Array.isArray(value) || !value.length || value.length > 9) throw Error('任务消息载荷无效');
  const parts = [], refs = new Set(); let textCount = 0;
  for (const part of value) {
    if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim() && part.text.length <= 5000 && ++textCount === 1) {
      parts.push({ type: 'text', text: part.text });
    } else if (part?.type === 'heldImage' && typeof part.id === 'string' && IMAGE_REF.test(part.id) && !refs.has(part.id) && refs.size < 8) {
      refs.add(part.id); parts.push({ type: 'heldImage', id: part.id });
    } else throw Error('任务消息载荷无效');
  }
  return parts;
}

export function taskInputAfterTextEdit(input, previousText, nextText) {
  if (!input || previousText === nextText) return input;
  const parts = input.filter(part => part.type !== 'text');
  parts.unshift({ type: 'text', text: nextText });
  return normalizeChecklistInput(parts);
}
