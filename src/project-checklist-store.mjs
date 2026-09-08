import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { normalizeChecklistAction } from './project-checklist-contract.mjs';
export class ProjectChecklistStore {
  constructor(directory) { this.directory = directory; this.chain = Promise.resolve(); }
  file(key) {
    if (typeof key !== 'string' || !key.trim() || key.length > 1000) throw Error('无效项目');
    return path.join(this.directory, createHash('sha256').update(key).digest('hex') + '.json');
  }
  async read(key) {
    try {
      const file = this.file(key);
      if ((await fs.stat(file)).size > 8_000_000) throw Error('清单过大');
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.receipts)) throw Error('清单损坏');
      if (data.items.length > 1000 || data.receipts.some(id => typeof id !== 'string')) throw Error('清单损坏');
      for (const item of data.items) normalizeChecklistAction({ ...item, projectKey: key, requestId: 'validate', type: 'upsert' });
      return data;
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, items: [], receipts: [] }; throw error; }
  }
  apply(value) {
    const action = normalizeChecklistAction(value);
    const operation = this.chain.then(async () => {
      const data = await this.read(action.projectKey);
      if (data.receipts.includes(action.requestId)) return action.requestId;
      const index = data.items.findIndex(item => item.id === action.id);
      if (action.type === 'delete') data.items = data.items.filter(item => item.id !== action.id);
      else {
        const item = { id: action.id, text: action.text, done: action.done, updatedAt: new Date().toISOString() };
        if (index >= 0) data.items[index] = item; else data.items.push(item);
      }
      if (data.items.length > 1000) throw Error('清单最多保存 1000 项');
      data.receipts = [...data.receipts, action.requestId].slice(-2000);
      const text = JSON.stringify(data);
      if (Buffer.byteLength(text) > 8_000_000) throw Error('清单过大');
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = this.file(action.projectKey), temporary = target + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
      return action.requestId;
    });
    this.chain = operation.catch(() => {}); return operation;
  }
}
