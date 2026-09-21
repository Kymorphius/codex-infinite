export function summarizeNativeHeldMessage(value) {
  const found = [];
  const visit = (entry, depth = 0) => {
    if (found.length >= 4 || depth > 6 || entry == null) return;
    if (typeof entry === 'string') { const text = entry.replace(/\s+/g, ' ').trim(); if (text && !/^data:/i.test(text) && text.length < 12000) found.push(text); return; }
    if (Array.isArray(entry)) { for (const part of entry) visit(part, depth + 1); return; }
    if (typeof entry === 'object') for (const key of ['text','prompt','content','input']) if (Object.hasOwn(entry, key)) visit(entry[key], depth + 1);
  };
  visit(value);
  return found.join(' · ').slice(0, 240) || '含附件或结构化内容的消息';
}
