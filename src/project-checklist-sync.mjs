import { buildNativeGeneralChecklistScript } from './native-general-checklist.mjs';
import { buildNativeProjectChecklistScript } from './native-project-checklist.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { assignedChecklistTasksForThread } from './project-checklist-assignment.mjs';
const publishedGeneralSnapshots = new WeakMap();
export async function syncProjectChecklist(connection, store) {
  if (!store || !await connection.evaluate("location.href === 'app://-/index.html'")) return;
  await connection.evaluate(buildNativeProjectChecklistScript());
  await connection.evaluate(buildNativeGeneralChecklistScript());
  const migrationNeeded = await connection.evaluate('Boolean(window.__cccProjectChecklist?.hasLegacyDrafts?.())');
  if (migrationNeeded) {
    const existing = (await store.read('ccc:general-inbox:v1')).items;
    const snapshot = JSON.stringify(existing).replaceAll('<', '\\u003c');
    await connection.evaluate(`window.__cccProjectChecklist?.cacheGeneral(${snapshot},false)`);
  }
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
  let claimableCount = 0, assignedSnapshot = { threadId: null, items: [] }, generalItems = [], generalRead = false;
  try {
    generalItems = (await store.read('ccc:general-inbox:v1')).items;
    generalRead = true;
    claimableCount = generalItems.filter(item => !item.done && !item.assignedThreadId).length;
    const threadId = await connection.evaluate(`(${readNativeComposerThreadId.toString()})(document)`);
    assignedSnapshot = { threadId, items: assignedChecklistTasksForThread(generalItems, threadId) };
  }
  catch { /* checklist read error is reported through the active list above */ }
  const result = JSON.stringify({ projectKey: packet.projectKey, items, acknowledged, error }).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__cccProjectChecklist?.accept(${result})`);
  const generalSnapshot = JSON.stringify(generalItems).replaceAll('<', '\\u003c');
  if (generalRead && publishedGeneralSnapshots.get(connection) !== generalSnapshot) {
    await connection.evaluate(`window.__cccProjectChecklist?.cacheGeneral(${generalSnapshot},true)`);
    publishedGeneralSnapshots.set(connection, generalSnapshot);
  }
  await connection.evaluate(`window.__codexControlConsoleSetClaimableTaskCount?.(${claimableCount})`);
  const assignedPayload = JSON.stringify(assignedSnapshot).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__codexControlConsoleSetAssignedChecklistTasks?.(${assignedPayload})`);
}
