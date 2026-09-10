import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import readline from 'node:readline';
import { CloneRecordTransform } from './project-clone-records.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_HEADER = 4 * 1024 * 1024;

export async function readCloneMetadata(filePath) {
  const file = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_HEADER);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline < 0) throw new Error('Rollout metadata must end with a newline within 4 MiB');
    const record = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
    if (record.type !== 'session_meta' || !UUID.test(record.payload?.id || record.payload?.session_id || '')) throw new Error('Invalid rollout identity');
    return { record, offset: newline + 1 };
  } finally { await file.close(); }
}

export function rekeyCloneMetadata(record, { sourceThreadId, localThreadId, cwd, idMap }) {
  if (!UUID.test(localThreadId) || (record.payload.id || record.payload.session_id).toLowerCase() !== sourceThreadId.toLowerCase()) throw new Error('Rollout identity mismatch');
  if (!path.isAbsolute(cwd)) throw new Error('Clone working directory must be absolute');
  const next = structuredClone(record), payload = next.payload;
  payload.id = localThreadId; payload.session_id = idMap[record.payload.session_id] || localThreadId; payload.cwd = cwd;
  payload.thread_source = payload.source?.subagent ? (record.payload.thread_source || 'subagent') : 'codex-control-console-project-copy';
  for (const key of ['parent_thread_id', 'forked_from_id']) {
    if (idMap[payload[key]]) payload[key] = idMap[payload[key]];
  }
  const spawn = payload.source?.subagent?.thread_spawn;
  if (spawn && idMap[spawn.parent_thread_id]) spawn.parent_thread_id = idMap[spawn.parent_thread_id];
  return next;
}

export function cloneRolloutPath(sessionRoot, timestamp, localThreadId) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp) || !UUID.test(localThreadId)) throw new Error('Invalid clone filename metadata');
  return path.join(sessionRoot, ...timestamp.slice(0, 10).split('-'), `rollout-${timestamp.slice(0, 19).replaceAll(':', '-')}-${localThreadId}.jsonl`);
}

export async function verifyCloneHistory(filePath, { localThreadId, cwd, bodySha256, originalBodyBytes }) {
  const { record, offset } = await readCloneMetadata(filePath);
  if (record.payload.id !== localThreadId || record.payload.cwd !== cwd) throw new Error('Existing clone metadata does not match receipt');
  const bodyHash = createHash('sha256');
  let bodyBytes = 0;
  const end = originalBodyBytes == null ? undefined : offset + originalBodyBytes - 1;
  if (originalBodyBytes !== 0) for await (const chunk of createReadStream(filePath, { start: offset, end })) { bodyHash.update(chunk); bodyBytes += chunk.length; }
  const actual = bodyHash.digest('hex');
  if (actual !== bodySha256) throw new Error('Clone history body checksum mismatch');
  const bytes = (await fs.stat(filePath)).size;
  if (originalBodyBytes != null && bodyBytes !== originalBodyBytes) throw new Error('Clone history was truncated');
  let nativeSettingsRecords = 0;
  if (bytes > offset + bodyBytes) {
    if (bytes - offset - bodyBytes > 1024 * 1024) throw new Error('Unexpected clone suffix size');
    const chunks = [];
    for await (const chunk of createReadStream(filePath, { start: offset + bodyBytes })) chunks.push(chunk);
    for (const line of Buffer.concat(chunks).toString('utf8').trim().split('\n')) {
      const record = JSON.parse(line), payload = record.payload;
      if (record.type !== 'event_msg' || payload?.type !== 'thread_settings_applied' || payload.thread_id !== localThreadId || payload.thread_settings?.cwd !== cwd) throw new Error('Unexpected clone history suffix');
      nativeSettingsRecords++;
    }
  }
  return { bodyBytes, bodySha256: actual, bytes, nativeSettingsRecords };
}

export async function cloneVerifiedHistory({ sourcePath, destinationPath, sourceThreadId, localThreadId, cwd, idMap, sha256, bodySha256, originalBodyBytes, nativeBodySha256 }) {
  if (!/^[0-9a-f]{64}$/.test(sha256) || !/^[0-9a-f]{64}$/.test(bodySha256)) throw new Error('Source checksums are required');
  const { record, offset } = await readCloneMetadata(sourcePath);
  const metadata = rekeyCloneMetadata(record, { sourceThreadId, localThreadId, cwd, idMap });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  try {
    await fs.lstat(destinationPath);
    try {
      return { ...(await verifyCloneHistory(destinationPath, { localThreadId, cwd, bodySha256: nativeBodySha256 || bodySha256, originalBodyBytes })), resumed: true };
    } catch (error) {
      if (nativeBodySha256) throw error;
      // A newly published paginated clone can outlive a crash before its receipt save.
      const records = new CloneRecordTransform(idMap), sourceHash = createHash('sha256');
      const check = new Transform({ transform(chunk, encoding, callback) { sourceHash.update(chunk); callback(null, chunk); } });
      await pipeline(createReadStream(sourcePath, { highWaterMark: 1024 * 1024 }), check, records, new Writable({ write(chunk, encoding, callback) { callback(); } }));
      if (sourceHash.digest('hex') !== sha256) throw new Error('Source checksum mismatch during clone recovery');
      const recoveredHash = records.bodyHash.digest('hex');
      return { ...(await verifyCloneHistory(destinationPath, { localThreadId, cwd, bodySha256: recoveredHash, originalBodyBytes })), nativeBodySha256: recoveredHash, resumed: true };
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${destinationPath}.${randomUUID()}.partial`;
  const sourceHash = createHash('sha256'), bodyHash = createHash('sha256');
  let consumed = 0, writtenHeader = false, bodyBytes = 0;
  const transform = new Transform({ transform(chunk, encoding, callback) {
    sourceHash.update(chunk);
    if (!writtenHeader) { this.push(`${JSON.stringify(metadata)}\n`); writtenHeader = true; }
    const skip = Math.max(0, offset - consumed); consumed += chunk.length;
    const body = chunk.subarray(Math.min(skip, chunk.length));
    bodyHash.update(body); bodyBytes += body.length; this.push(body); callback();
  } });
  const records = new CloneRecordTransform(idMap);
  try {
    await pipeline(createReadStream(sourcePath, { highWaterMark: 1024 * 1024 }), transform, records, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    if (sourceHash.digest('hex') !== sha256 || bodyHash.digest('hex') !== bodySha256) throw new Error('Source rollout changed or failed checksum verification');
    const handle = await fs.open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    // link() fails if another file appeared, unlike rename() which may overwrite it.
    await fs.link(temporary, destinationPath);
    return { bodyBytes, bodySha256, nativeBodySha256: records.bodyHash.digest('hex'), changedRecords: records.changedRecords, bytes: (await fs.stat(destinationPath)).size, resumed: false };
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function hasOnlyInheritedHistory(filePath) {
  const { record, offset } = await readCloneMetadata(filePath);
  const cutoff = record.payload.subagent_history_start_ordinal;
  if (record.payload.history_mode !== 'paginated' || !Number.isSafeInteger(cutoff)) return false;
  const lines = readline.createInterface({ input: createReadStream(filePath, { start: offset }), crlfDelay: Infinity });
  let maximum = -1;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const ordinal = JSON.parse(line).ordinal;
    if (Number.isSafeInteger(ordinal)) maximum = Math.max(maximum, ordinal);
  }
  return maximum >= 0 && maximum < cutoff;
}
