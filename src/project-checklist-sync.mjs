import { buildNativeGeneralChecklistScript } from './native-general-checklist.mjs';
import { buildNativeProjectChecklistScript } from './native-project-checklist.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { assignedChecklistTasksForThread } from './project-checklist-assignment.mjs';
const publishedGeneralSnapshots = new WeakMap();
export async function syncProjectChecklist(connection, store) {
  if (!store || !await connection.evaluate("location.href === 'app://-/index.html'")) return;
  await store.prepare?.(connection);
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
  const acknowledged = [], rejected = [], rejectionErrors = [], conflicts = [], actionResults = [], touched = new Set(); let error = '', items;
  for (const action of Array.isArray(packet.actions) ? packet.actions.slice(0, 20) : []) {
    const key = JSON.stringify(action.sourceRef || [action.projectKey, action.id]);
    if (touched.has(key)) continue;
    touched.add(key);
    try {
      const applied = await store.apply(action);
      acknowledged.push(typeof applied === 'string' ? applied : applied.requestId);
      if (applied?.item) actionResults.push({ requestId: action.requestId, sourceRef: action.sourceRef, projectKey: action.projectKey, id: action.id, previousRevision: action.expectedRevision, item: applied.item });
    } catch (reason) {
      error = reason.message || '任务保存失败，草稿已保留';
      if (['verify-delivery', 'release-delivery'].includes(action.type)) { rejected.push(action.requestId); rejectionErrors.push({ requestId: action.requestId, message: error, code: reason.code, statusCode: reason.statusCode }); }
      else if (reason.statusCode === 409 || reason.statusCode === 404 || ['REVISION_CONFLICT', 'TASK_NOT_FOUND'].includes(reason.code)) conflicts.push({ requestId: action.requestId, sourceRef: action.sourceRef, projectKey: action.projectKey, id: action.id, error });
    }
  }
  if (packet.projectKey) {
    try { items = (await store.read(packet.projectKey)).items; }
    catch { error = '清单读取失败，请重试'; }
  }
  let claimableCount = 0, assignedSnapshot = { threadId: null, items: [] }, generalItems = [], generalRead = false;
  try {
    generalItems = (await store.read('ccc:general-inbox:v1')).items;
    generalRead = true;
    claimableCount = generalItems.filter(item => !item.done && item.executionState !== 'delivered' && !item.assignedThreadId).length;
    const threadId = await connection.evaluate(`(${readNativeComposerThreadId.toString()})(document)`);
    assignedSnapshot = { threadId, items: assignedChecklistTasksForThread(generalItems, threadId) };
  }
  catch { /* checklist read error is reported through the active list above */ }
  const result = JSON.stringify({ projectKey: packet.projectKey, items, acknowledged, rejected, rejectionErrors, conflicts, actionResults, error }).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__cccProjectChecklist?.accept(${result})`);
  const generalSnapshot = JSON.stringify(generalItems).replaceAll('<', '\\u003c');
  const publishedKey = JSON.stringify([packet.instanceId || null, generalSnapshot]);
  if (generalRead && publishedGeneralSnapshots.get(connection) !== publishedKey) {
    await connection.evaluate(`window.__cccProjectChecklist?.cacheGeneral(${generalSnapshot},true)`);
    publishedGeneralSnapshots.set(connection, publishedKey);
  }
  await connection.evaluate(`window.__codexControlConsoleSetClaimableTaskCount?.(${claimableCount})`);
  const assignedPayload = JSON.stringify(assignedSnapshot).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__codexControlConsoleSetAssignedChecklistTasks?.(${assignedPayload})`);
}
