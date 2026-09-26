import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { taskRevision } from './task-center-contract.mjs';

// An archive contains only receipts already committed atomically with task state.
// A scope retains its newest receipt until a later successful archive write.
export class TaskCenterReceiptArchive {
  constructor(root) { this.directory = path.join(root, 'task-receipts'); }
  file(requestId) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(requestId)) throw Error('任务回执编号无效');
    return path.join(this.directory, createHash('sha256').update(requestId).digest('hex') + '.json');
  }
  async checkDirectory() {
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('任务回执目录不能是符号链接');
  }
  async read(requestId) {
    const file = this.file(requestId);
    let handle;
    try {
      await this.checkDirectory();
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error('任务回执不能是符号链接');
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if ((await handle.stat()).size > 8_000_000) throw Error('任务回执过大');
      const receipt = JSON.parse(await handle.readFile('utf8'));
      if (receipt?.requestId !== requestId || !/^[0-9a-f]{64}$/.test(receipt.actionHash || '') || receipt.result?.applied !== true || receipt.result?.requestId !== requestId) throw Error('任务回执损坏');
      return receipt;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    finally { await handle?.close(); }
  }
  async store(receipt) {
    const existing = await this.read(receipt.requestId);
    if (existing) {
      if (taskRevision(existing) !== taskRevision(receipt)) throw Error('任务归档回执存在冲突');
      return;
    }
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const target = this.file(receipt.requestId), temporary = target + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, target);
    } finally { await fs.rm(temporary, { force: true }); }
  }
}
