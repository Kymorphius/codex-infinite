import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { httpError } from './http-utils.mjs';
import { DISCUSSION_LIMITS, discussionId } from './discussion-contract.mjs';

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// Discussions are inert data next to the conversations they reference; deleting the file
// never touches a conversation. Writes are serialized and atomic; a corrupt or foreign
// file fails closed and is left as found.
export class DiscussionStore {
  constructor({ filePath, deviceId, now = () => new Date(), idFactory = randomUUID } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw Error('Discussion filePath must be absolute');
    this.filePath = filePath; this.deviceId = deviceId; this.now = now; this.idFactory = idFactory;
    this.records = new Map(); this.ready = null; this.mutations = Promise.resolve();
  }

  init() { return this.ready ||= this.load(); }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > MAX_FILE_BYTES) throw Error('too large');
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (data.version !== 1 || data.deviceId !== this.deviceId || !Array.isArray(data.discussions)
          || data.discussions.length > DISCUSSION_LIMITS.discussions) throw Error('invalid');
      this.records = new Map(data.discussions.map(item => [discussionId(item.id), item]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw httpError(503, '讨论记录无法读取，已保留原文件');
    }
  }

  async list() { await this.init(); await this.mutations; return structuredClone([...this.records.values()]); }

  async get(id) {
    await this.init(); await this.mutations;
    const record = this.records.get(discussionId(id));
    if (!record) throw httpError(404, '讨论不存在');
    return structuredClone(record);
  }

  mutate(operation) {
    const result = this.mutations.then(async () => { await this.init(); return operation(); });
    this.mutations = result.catch(() => {});
    return result;
  }

  async save(records) {
    const content = JSON.stringify({ version: 1, deviceId: this.deviceId, discussions: [...records.values()] });
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw httpError(429, '讨论记录容量已达上限');
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
      await fs.rename(temporary, this.filePath);
      this.records = records;
    } finally { await fs.rm(temporary, { force: true }); }
  }

  create(fields) {
    return this.mutate(async () => {
      if (this.records.size >= DISCUSSION_LIMITS.discussions) throw httpError(429, '讨论数量已达上限');
      const at = this.now().toISOString();
      const record = { ...fields, id: this.idFactory(), mode: 'manual', reviewGate: true, status: 'idle', round: 0,
        maxRounds: 4, held: null, cursors: { claude: null, gpt: null }, pendingComments: [], messages: [],
        createdAt: at, updatedAt: at, revision: 1 };
      const records = new Map(this.records); records.set(record.id, record);
      await this.save(records); return structuredClone(record);
    });
  }

  // `change` receives a clone of the current record and returns the next one; a revision
  // mismatch (a concurrent change) is a 409 so the caller never overwrites newer state.
  update(id, expectedRevision, change) {
    return this.mutate(async () => {
      const current = this.records.get(discussionId(id));
      if (!current) throw httpError(404, '讨论不存在');
      if (current.revision !== expectedRevision) throw httpError(409, '讨论已变更，请刷新后重试');
      const next = await change(structuredClone(current));
      const records = new Map(this.records); records.set(next.id, next);
      await this.save(records); return structuredClone(next);
    });
  }
}
