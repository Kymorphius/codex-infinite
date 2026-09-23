export function summarizeNativeHeldMessage(value) {
  const found = [];
  let images = 0;
  const visit = (entry, depth = 0) => {
    if (depth > 6 || entry == null) return;
    if (typeof entry === 'string') { const text = entry.replace(/\s+/g, ' ').trim(); if (found.length < 4 && text && !/^data:/i.test(text) && text.length < 12000) found.push(text); return; }
    if (Array.isArray(entry)) { for (const part of entry) visit(part, depth + 1); return; }
    if (typeof entry === 'object') {
      if (['heldImage', 'image', 'localImage', 'local_image'].includes(entry.type)) images += 1;
      for (const key of ['text','prompt','content','input']) if (Object.hasOwn(entry, key)) visit(entry[key], depth + 1);
    }
  };
  visit(value);
  const summary = found.join(' · ').slice(0, 220), badge = images ? `图片 ${images} 张` : '';
  return [summary, badge].filter(Boolean).join(' · ') || '含附件或结构化内容的消息';
}
