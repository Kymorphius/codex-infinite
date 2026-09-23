export async function pauseNativeQueuedItem(id, item, editAfterPause, context) {
  if (context.busy() || id !== context.threadId() || !item?.id || item.input == null) return;
  const editableText = editAfterPause ? context.readEditableText(item.input) : null;
  if (editAfterPause && editableText == null) { context.warn('这条消息没有可安全编辑的单一文字内容'); return; }
  context.setBusy(true);
  const before = context.heldFor(id);
  const held = { id: crypto.randomUUID(), input: item.input, summary: context.summarize(item.input), heldAt: Date.now(), origin: 'paused-queue' };
  let deleted = false;
  try {
    held.input = await context.imageTools.captureQueueInput(item.input, held.id);
    context.writeHeld(id, [...before, held]);
    const result = await context.request('thread/queue/delete', { threadId: id, queuedSubmissionId: item.id });
    if (!result?.deleted) throw new Error('原生队列项已经变化，请先同步');
    deleted = true;
    try { const migrationError = context.migrateLegacyTodos(); if (migrationError) context.warn(migrationError); }
    catch { context.warn('待办已暂停，任务中心同步稍后重试'); }
    const next = await context.listQueue(id);
    if (id !== context.threadId()) return;
    context.setServerItems(next);
    if (editAfterPause) context.setEditing({ id: held.id, value: editableText });
  } catch (error) {
    if (!deleted) { try { context.writeHeld(id, before); } catch {} await context.imageTools.release(held.input).catch(() => {}); }
    if (id === context.threadId()) context.warn(error.message || '暂停失败');
  } finally { context.setBusy(false); }
}

export async function resumeNativeHeldItem(id, held, context) {
  if (context.busy() || id !== context.threadId()) return;
  context.setBusy(true);
  try {
    const input = await context.imageTools.hydrate(held.input);
    await context.request('thread/queue/add', { threadId: id, input, clientUserMessageId: crypto.randomUUID() });
    context.writeHeld(id, context.heldFor(id).filter(item => item.id !== held.id));
    const cleanupWarning = await context.imageTools.release(held.input).then(() => '', () => '已加入发送队列，图片缓存稍后需要清理');
    const next = await context.listQueue(id);
    if (id !== context.threadId()) return;
    context.setServerItems(next); context.warn(cleanupWarning);
  } catch (error) { if (id === context.threadId()) context.warn(error.message || '加入发送队列失败'); }
  finally { context.setBusy(false); }
}

export async function reorderNativeQueuedItems(id, index, offset, context) {
  const items = context.serverItems(), next = index + offset;
  if (context.busy() || id !== context.threadId() || next < 0 || next >= items.length) return;
  context.setBusy(true);
  const reordered = [...items]; [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
  try {
    await context.request('thread/queue/reorder', { threadId: id, queuedSubmissionIds: reordered.map(item => item.id) });
    if (id === context.threadId()) { context.setServerItems(reordered); context.warn(''); }
  } catch (error) { if (id === context.threadId()) context.warn(error.message || '排序失败'); }
  finally { context.setBusy(false); }
}
