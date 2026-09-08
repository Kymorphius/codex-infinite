import { annotationId } from './turn-annotation-contract.mjs';
import { buildNativeTurnAnnotationsScript } from './native-turn-annotations.mjs';
export async function syncTurnAnnotations(connection, store) {
  if (!store) return;
  // This bridge reads and mutates only the exact dedicated app document.
  const validPage = await connection.evaluate("location.href === 'app://-/index.html'");
  if (!validPage) return;
  await connection.evaluate(buildNativeTurnAnnotationsScript());
  const packet = await connection.evaluate('window.__codexControlConsoleAnnotations?.packet()');
  if (!packet) return;
  const acknowledged = []; let error = '';
  for (const action of Array.isArray(packet.actions) ? packet.actions.slice(0, 20) : []) {
    try { acknowledged.push(await store.apply(action)); }
    catch { error = '批注保存失败，草稿已保留，将自动重试'; break; }
  }
  const threadId = annotationId(packet.threadId); let notes;
  if (threadId) {
    try { notes = (await store.read(threadId)).notes; }
    catch { error = '批注读取失败，原文件未被覆盖'; }
  }
  const result = JSON.stringify({ threadId, notes, acknowledged, error }).replaceAll('<', '\\u003c');
  await connection.evaluate(`window.__codexControlConsoleAnnotations?.accept(${result})`);
}
