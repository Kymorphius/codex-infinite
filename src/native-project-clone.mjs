import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { cloneVerifiedHistory, cloneRolloutPath, readCloneMetadata, rekeyCloneMetadata, hasOnlyInheritedHistory } from './project-clone-history.mjs';
import { upgradeCloneHistoryReferences } from './project-clone-history-upgrade.mjs';

async function save(file, receipt) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(temporary, JSON.stringify(receipt, null, 2), { mode: 0o600 });
  await fs.rename(temporary, file);
}

export async function cloneNativeProject({ manifest, stagedHome, codexHome, roots, fallbackCwd, receiptPath, client, registry, prepareOnly = false, indexOnly = false, progress = () => {} }) {
  if (!roots.length || roots.some(root => !path.isAbsolute(root)) || !roots.includes(fallbackCwd)) throw new Error('Invalid selected roots');
  const fingerprint = createHash('sha256').update(JSON.stringify({ manifest, roots, fallbackCwd, codexHome })).digest('hex');
  let receipt;
  try { receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (receipt && receipt.fingerprint !== fingerprint) throw new Error('Clone receipt belongs to a different operation');
  if (!receipt) {
    receipt = { version: 1, fingerprint, roots, sourceProjectId: manifest.projectId, sessions: manifest.sessions.map(session => {
      const localThreadId = randomUUID();
      const cwd = roots.some(root => session.cwd === root || session.cwd.startsWith(`${root}/`)) || roots.some(root => path.dirname(root) === session.cwd) ? session.cwd : fallbackCwd;
      return { sourceThreadId: session.sourceThreadId, localThreadId, originalCwd: session.cwd, cwd, path: cloneRolloutPath(path.join(codexHome, 'sessions'), session.timestamp, localThreadId) };
    }) };
    if (new Set(receipt.sessions.map(item => item.sourceThreadId)).size !== receipt.sessions.length) throw new Error('Duplicate source identities');
    await save(receiptPath, receipt);
  }
  const idMap = Object.fromEntries(receipt.sessions.map(item => [item.sourceThreadId, item.localThreadId]));
  for (let index = 0; index < receipt.sessions.length; index++) {
    const item = receipt.sessions[index], session = manifest.sessions[index];
    const sourcePath = path.resolve(stagedHome, session.relativePath);
    if (!sourcePath.startsWith(`${path.resolve(stagedHome)}/`)) throw new Error('Source rollout escapes staging');
    if (await fs.stat(`${item.path}.clone-upgrade.json`).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) Object.assign(item, await upgradeCloneHistoryReferences({ filePath: item.path, ...item, bodySha256: item.nativeBodySha256 || session.bodySha256, originalBodyBytes: item.bodyBytes, idMap }));
    const result = await cloneVerifiedHistory({ sourcePath, destinationPath: item.path, sourceThreadId: item.sourceThreadId, localThreadId: item.localThreadId, cwd: item.cwd, idMap, sha256: session.sha256, bodySha256: session.bodySha256, originalBodyBytes: item.bodyBytes, nativeBodySha256: item.nativeBodySha256 });
    if (result.resumed && !item.nativeBodySha256 && !result.nativeBodySha256) Object.assign(item, await upgradeCloneHistoryReferences({ filePath: item.path, ...item, bodySha256: session.bodySha256, originalBodyBytes: result.bodyBytes, idMap }));
    else if (result.nativeBodySha256) { item.nativeBodySha256 = result.nativeBodySha256; item.changedRecords = result.changedRecords; }
    if (item.metadataFormatVersion !== 2) {
      const expectedMetadata = rekeyCloneMetadata((await readCloneMetadata(sourcePath)).record, { ...item, idMap });
      if (JSON.stringify((await readCloneMetadata(item.path)).record) !== JSON.stringify(expectedMetadata)) Object.assign(item, await upgradeCloneHistoryReferences({ filePath: item.path, ...item, bodySha256: item.nativeBodySha256, originalBodyBytes: result.bodyBytes, idMap, expectedMetadata }));
      item.metadataFormatVersion = 2;
    }
    item.verified = true; item.bodyBytes = result.bodyBytes;
    await save(receiptPath, receipt);
    await fs.rm(`${item.path}.clone-upgrade.json`, { force: true });
    progress({ phase: 'copied', index: index + 1, total: receipt.sessions.length });
  }
  if (prepareOnly) return receipt;
  await client.initialize();
  for (let index = 0; index < receipt.sessions.length; index++) {
    const item = receipt.sessions[index], session = manifest.sessions[index];
    if (item.indexed && item.historyVerified) continue;
    const indexed = await client.request('thread/read', { threadId: item.localThreadId, includeTurns: false });
    if (!indexed?.thread?.path || await fs.realpath(indexed.thread.path) !== await fs.realpath(item.path)) throw new Error(`Native rollout path mismatch: ${item.localThreadId}`);
    if (!item.indexed && session.title) await client.request('thread/name/set', { threadId: item.localThreadId, name: session.title });
    if (session.isProjectThread && !item.archived) {
      await client.request('thread/resume', { threadId: item.localThreadId, cwd: item.cwd, excludeTurns: true });
      const page = await client.request('thread/turns/list', { threadId: item.localThreadId, limit: 1 });
      item.historyPageCount = page.data?.length || 0;
      if (!item.historyPageCount) {
        if (!(await hasOnlyInheritedHistory(path.resolve(stagedHome, session.relativePath)))) throw new Error(`Project conversation has no readable history: ${item.localThreadId}`);
        item.historyState = 'inherited-only';
      } else item.historyState = 'readable';
      await client.request('thread/unsubscribe', { threadId: item.localThreadId });
      item.historyMaterialized = true;
    }
    item.indexed = true; item.historyVerified = true; item.nativeCwd = indexed.thread.cwd;
    await save(receiptPath, receipt);
    progress({ phase: 'indexed', index: index + 1, total: receipt.sessions.length });
  }
  if (indexOnly) return receipt;
  for (const root of roots) { if (!(await fs.stat(root)).isDirectory()) throw new Error(`Selected root is not a directory: ${root}`); }
  for (const item of receipt.sessions) {
    if (item.originalCwd === item.cwd || item.runtimeCwdApplied) continue;
    const resumed = await client.request('thread/resume', { threadId: item.localThreadId, cwd: item.cwd, excludeTurns: true });
    if (resumed.cwd !== item.cwd) throw new Error('Native working directory override was not applied');
    await client.request('thread/settings/update', { threadId: item.localThreadId, cwd: item.cwd });
    await client.request('thread/unsubscribe', { threadId: item.localThreadId });
    item.runtimeCwdApplied = true;
    await save(receiptPath, receipt);
  }
  const mainIds = receipt.sessions.filter((item, index) => manifest.sessions[index].isProjectThread).map(item => item.localThreadId);
  if (!receipt.projectId) {
    const result = await client.request('project/import', { idempotencyKey: `verified-clone-${fingerprint}`, name: manifest.projectName, roots: roots.map(root => ({ path: root })), threads: mainIds });
    receipt.projectId = result?.project?.id || result?.id;
    if (!receipt.projectId) throw new Error('Native project import did not return a project ID');
    await save(receiptPath, receipt);
  }
  for (let index = 0; index < receipt.sessions.length; index++) {
    const item = receipt.sessions[index];
    if (manifest.sessions[index].archived && !item.archived) {
      await client.request('thread/archive', { threadId: item.localThreadId });
      const archived = await client.request('thread/read', { threadId: item.localThreadId, includeTurns: false });
      if (!archived?.thread?.path) throw new Error('Archived rollout path unavailable');
      item.path = archived.thread.path; item.archived = true;
      await save(receiptPath, receipt);
    }
  }
  const sidebar = await registry.register({ serverProjectId: receipt.projectId, projectName: manifest.projectName, rootPaths: roots, threadIds: mainIds });
  receipt.sidebarProjectId = sidebar.projectId; receipt.completedAt = new Date().toISOString();
  await save(receiptPath, receipt);
  return receipt;
}
