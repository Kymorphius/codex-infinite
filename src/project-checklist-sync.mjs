import { buildNativeGeneralChecklistScript } from './native-general-checklist.mjs';
import { buildNativeProjectChecklistScript } from './native-project-checklist.mjs';
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
  let claimableCount = 0;
  try { claimableCount = (await store.read('ccc:general-inbox:v1')).items.filter(item => !item.done && !item.assignedThreadId).length; }
  catch { /* checklist read error is reported through the active list above */ }
  await connection.evaluate(`window.__codexControlConsoleSetClaimableTaskCount?.(${claimableCount})`);
  const result = JSON.stringify({ projectKey: packet.projectKey, items, acknowledged, error }).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__cccProjectChecklist?.accept(${result})`);
}
