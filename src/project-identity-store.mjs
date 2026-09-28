import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { syncError, syncProjectId } from './project-sync-contract.mjs';

const MAX_BYTES = 4 * 1024 * 1024;

export class ProjectIdentityStore {
  constructor({ filePath }) { this.filePath = filePath; }

  async read() {
    let handle;
    try {
      const info = await fs.lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) throw Error('invalid file');
      handle = await fs.open(this.filePath, 'r');
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_BYTES) throw Error('oversize');
      const data = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
      if (data?.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 5000) throw Error('invalid data');
      const entries = new Map();
      for (const entry of data.entries) {
        if (typeof entry?.path !== 'string' || !path.isAbsolute(entry.path) || entry.path.length > 4096
          || /[\0\r\n]/.test(entry.path) || entries.has(entry.path)) throw Error('invalid entry');
        entries.set(entry.path, syncProjectId(entry.projectId));
      }
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT') return new Map();
      throw syncError('项目关联记录无法读取，请检查本机关联存储；不会覆盖原记录', 503);
    } finally { await handle?.close(); }
  }

  async set(root, expectedId, projectId) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || root.length > 4096 || /[\0\r\n]/.test(root)) throw syncError('项目目录无效', 400);
    if (expectedId !== null) syncProjectId(expectedId);
    if (projectId !== null) syncProjectId(projectId);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${this.filePath}.lock`, temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let lock;
    try { lock = await fs.open(lockPath, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') throw syncError('项目关联记录正被其他操作使用；若重启后仍出现，请检查遗留写锁', 409);
      throw error;
    }
    try {
      const entries = await this.read(), current = entries.get(root) || null;
      if (current !== expectedId && current !== projectId) throw syncError('项目关联已变化，请刷新后重新预检');
      if (current === projectId) return { path: root, projectId };
      if (projectId === null) entries.delete(root); else entries.set(root, projectId);
      if (entries.size > 5000) throw syncError('项目关联数量超过上限', 413);
      const body = `${JSON.stringify({ version: 1, entries: [...entries].map(([path, projectId]) => ({ path, projectId })) })}\n`;
      if (Buffer.byteLength(body) > MAX_BYTES) throw syncError('项目关联记录超过容量上限', 413);
      const output = await fs.open(temporary, 'wx', 0o600);
      try { await output.writeFile(body); await output.sync(); } finally { await output.close(); }
      await fs.rename(temporary, this.filePath);
      return { path: root, projectId };
    } finally {
      await fs.rm(temporary, { force: true });
      await lock.close();
      await fs.rm(lockPath);
    }
  }
}
