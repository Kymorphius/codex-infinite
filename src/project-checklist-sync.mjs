import { buildNativeGeneralChecklistScript } from './native-general-checklist.mjs';
import { buildNativeProjectChecklistScript } from './native-project-checklist.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { assignedChecklistTasksForThread } from './project-checklist-assignment.mjs';
const publishedGeneralSnapshots = new WeakMap();
export async function syncProjectChecklist(connection, store) {
  if (!store || !await connection.evaluate("location.href === 'app://-/index.html'")) return;
  await connection.evaluate(buildNativeProjectChecklistScript());
  await connection.evaluate(buildNativeGeneralChecklistScript());
  const packet = await connection.evaluate('window.__cccProjectChecklist?.packet()');
  if (!packet) return;
  const acknowledged = []; let error = '', items;
  for (const action of Array.isArray(packet.actions) ? packet.actions.slice(0, 20) : []) {
    try { acknowledged.push(await store.apply(action)); }
    catch { error = '任务保存失败，草稿已保留'; break; }
  }
  if (packet.projectKey) {
    try { items = (await store.read(packet.projectKey)).items; }
    catch { error = '清单读取失败，请重试'; }
  }
  let claimableCount = 0, assignedTasks = [];
  try {
    const generalItems = (await store.read('ccc:general-inbox:v1')).items;
    claimableCount = generalItems.filter(item => !item.done && !item.assignedThreadId).length;
    const generalSnapshot = JSON.stringify(generalItems).replaceAll('<', '\\u003c');
    if (publishedGeneralSnapshots.get(connection) !== generalSnapshot) {
      await connection.evaluate(`window.__cccProjectChecklist?.cacheGeneral(${generalSnapshot})`);
      publishedGeneralSnapshots.set(connection, generalSnapshot);
    }
    const threadId = await connection.evaluate(`(${readNativeComposerThreadId.toString()})(document)`);
    assignedTasks = assignedChecklistTasksForThread(generalItems, threadId);
  }
  catch { /* checklist read error is reported through the active list above */ }
  await connection.evaluate(`window.__codexControlConsoleSetClaimableTaskCount?.(${claimableCount})`);
  const assignedPayload = JSON.stringify(assignedTasks).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__codexControlConsoleSetAssignedChecklistTasks?.(${assignedPayload})`);
  const result = JSON.stringify({ projectKey: packet.projectKey, items, acknowledged, error }).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__cccProjectChecklist?.accept(${result})`);
}
