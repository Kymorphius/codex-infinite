import { annotationId } from './turn-annotation-contract.mjs';
import { CdpConnection } from './cdp-client.mjs';
import { buildNativeTurnAnnotationsScript } from './native-turn-annotations.mjs';

export function isDashboardPageTarget(target, dashboardUrl) {
  if (target?.type !== 'page' || typeof target.url !== 'string' || typeof target.webSocketDebuggerUrl !== 'string') return false;
  try { return new URL(target.url).origin === new URL(dashboardUrl).origin; }
  catch { return false; }
}

async function readTargetVisibility(target) {
  const connection = new CdpConnection(target.webSocketDebuggerUrl, { commandTimeoutMs: 2000 });
  try { return await connection.evaluate("document.visibilityState === 'visible' && innerWidth > 0 && innerHeight > 0"); }
  finally { await connection.close(); }
}

export async function hasVisibleDashboardSurface(targets, dashboardUrl, inspect = readTargetVisibility) {
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!isDashboardPageTarget(target, dashboardUrl)) continue;
    try { if (await inspect(target)) return true; }
    catch { return true; }
  }
  return false;
}

export async function syncTurnAnnotations(connection, store, { targets = [], dashboardUrl = '', inspectTarget = readTargetVisibility } = {}) {
  if (!store) return;
  // This bridge reads and mutates only the exact dedicated app document.
  const validPage = await connection.evaluate("location.href === 'app://-/index.html'");
  if (!validPage) return;
  const presentationSuppressed = await hasVisibleDashboardSurface(targets, dashboardUrl, inspectTarget);
  await connection.evaluate(buildNativeTurnAnnotationsScript());
  await connection.evaluate(`window.__codexControlConsoleAnnotations?.setPresentationSuppressed(${presentationSuppressed})`);
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
