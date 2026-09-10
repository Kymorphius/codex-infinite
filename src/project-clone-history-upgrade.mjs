import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { CloneRecordTransform } from './project-clone-records.mjs';
import { verifyCloneHistory, readCloneMetadata } from './project-clone-history.mjs';

export async function upgradeCloneHistoryReferences({ filePath, localThreadId, cwd, bodySha256, originalBodyBytes, idMap, expectedMetadata }) {
  const journal = `${filePath}.clone-upgrade.json`;
  try {
    const pending = JSON.parse(await fs.readFile(journal, 'utf8'));
    if (pending.localThreadId !== localThreadId || pending.sourceBodySha256 !== bodySha256) throw new Error('History upgrade journal mismatch');
    try {
      await verifyCloneHistory(filePath, { localThreadId, cwd, bodySha256: pending.nativeBodySha256, originalBodyBytes });
      const current = (await readCloneMetadata(filePath)).record;
      if (createHash('sha256').update(JSON.stringify(current)).digest('hex') !== pending.metadataSha256) throw new Error('Pending metadata replacement is incomplete');
      return { nativeBodySha256: pending.nativeBodySha256, changedRecords: pending.changedRecords };
    } catch { /* An interrupted upgrade may still contain the original body. */ }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await verifyCloneHistory(filePath, { localThreadId, cwd, bodySha256, originalBodyBytes });
  const metadata = expectedMetadata || (await readCloneMetadata(filePath)).record;
  const metadataSha256 = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
  const before = await fs.stat(filePath);
  const temporary = `${filePath}.${randomUUID()}.upgrade`;
  const transform = new CloneRecordTransform(idMap, { originalBodyBytes, metadataHeader: Buffer.from(JSON.stringify(metadata) + '\n') });
  try {
    await pipeline(createReadStream(filePath, { highWaterMark: 1024 * 1024 }), transform, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const after = await fs.stat(filePath);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error('Clone changed during history migration');
    const handle = await fs.open(temporary, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
    const nativeBodySha256 = transform.bodyHash.digest('hex');
    await fs.writeFile(journal, JSON.stringify({ localThreadId, sourceBodySha256: bodySha256, nativeBodySha256, metadataSha256, changedRecords: transform.changedRecords }), { mode: 0o600 });
    await fs.rename(temporary, filePath);
    return { nativeBodySha256, changedRecords: transform.changedRecords };
  } finally { await fs.rm(temporary, { force: true }); }
}
