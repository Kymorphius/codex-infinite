import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { annotationId, normalizeAnnotationAction, normalizeAnnotationDocument } from './turn-annotation-contract.mjs';
export class TurnAnnotationStore {
  constructor(directory) { this.directory = directory; this.chain = Promise.resolve(); }
  file(threadId) { const id = annotationId(threadId); if (!id) throw Error('无效会话'); return path.join(this.directory, id + '.json'); }
  async read(threadId) {
    const file = this.file(threadId);
    try {
      if ((await fs.stat(file)).size > 8_000_000) throw Error('批注文件过大');
      return normalizeAnnotationDocument(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, notes: {} }; throw error; }
  }
  apply(value) {
    const action = normalizeAnnotationAction(value);
    const operation = this.chain.then(async () => {
      const document = await this.read(action.threadId);
      if (action.text.trim()) document.notes[action.turnId] = { text: action.text, updatedAt: new Date().toISOString() };
      else delete document.notes[action.turnId];
      const text = JSON.stringify(document, null, 2);
      if (Buffer.byteLength(text) > 8_000_000) throw Error('批注空间已满');
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = this.file(action.threadId), temporary = target + '.' + randomUUID() + '.tmp';
      try { await fs.writeFile(temporary, text, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, target); }
      finally { await fs.rm(temporary, { force: true }); }
      return action.requestId;
    });
    this.chain = operation.catch(() => {}); return operation;
  }
}
