export async function saveNativeHeldDraft({ threadId, editor, readText, imageTools, heldFor, writeHeld, summarize, clearText, setBusy, setWarning, render, updateButton }) {
  const id = threadId(), text = readText(editor), images = imageTools.images(editor);
  const sources = images.map((image) => image.currentSrc || image.src);
  if (!id || !editor || (!text && !images.length)) return;
  setBusy(true); updateButton();
  const heldId = crypto.randomUUID();
  let imageParts = [];
  try {
    imageParts = images.length ? await imageTools.capture(editor, heldId) : [];
    const currentSources = imageTools.images(editor).map((image) => image.currentSrc || image.src);
    if (id !== threadId() || readText(editor) !== text || JSON.stringify(currentSources) !== JSON.stringify(sources)) throw new Error('输入框内容已变化，请重新保存待办');
    const input = [...(text ? [{ type: 'text', text }] : []), ...imageParts];
    writeHeld(id, [...heldFor(id), { id: heldId, input, summary: summarize(input), heldAt: Date.now(), origin: 'draft' }]);
  } catch (error) {
    await imageTools.release(imageParts).catch(() => {});
    setWarning(error.message || '无法保存待办消息'); setBusy(false); render(); updateButton(); return;
  }
  const cleared = !text || (() => { try { return clearText(editor); } catch { return false; } })();
  setWarning(images.length
    ? `待办已保存；${cleared ? '原输入框图片仍在' : '原输入框内容仍在'}，请手动移除以免重复发送。`
    : cleared ? '' : '待办已保存，但输入框未能自动清空；请手动清空以免重复发送。');
  setBusy(false); render(); updateButton();
}
