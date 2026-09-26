import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { terminalError } from './terminal-contract.mjs';
import { TERMINAL_CONVERSATION_LIMIT, terminalConversationId, terminalConversationRecord,
  terminalConversationText } from './terminal-conversation-contract.mjs';

export class TerminalConversationStore {
  constructor({ filePath, deviceId, now = () => new Date(), idFactory = randomUUID } = {}) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw Error('Terminal conversation filePath must be absolute');
    this.filePath = filePath; this.deviceId = terminalConversationText(deviceId, '设备标识', 160);
    this.now = now; this.idFactory = idFactory; this.records = new Map();
    this.ready = null; this.mutations = Promise.resolve();
  }

  init() {
    if (!this.ready) this.ready = this.load();
    return this.ready;
  }

  async load() {
    try {
      if ((await fs.stat(this.filePath)).size > 16 * 1024 * 1024) throw Error('Registry too large');
      const data = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (data.version !== 1 || data.deviceId !== this.deviceId || !Array.isArray(data.conversations)
          || data.conversations.length > TERMINAL_CONVERSATION_LIMIT) throw Error('Invalid registry');
      const records = new Map();
      for (const input of data.conversations) {
        const record = terminalConversationRecord(input, this.deviceId);
        if (records.has(record.id)) throw Error('Duplicate conversation');
        records.set(record.id, record);
      }
      this.records = records;
    } catch (error) {
      if (error.code !== 'ENOENT') throw terminalError(503, '终端会话记录无法读取，已保留原文件');
    }
  }

  async list() {
    await this.init(); await this.mutations;
    return structuredClone([...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }

  async get(id) {
    id = terminalConversationId(id); await this.init(); await this.mutations;
    const record = this.records.get(id);
    if (!record) throw terminalError(404, '终端会话不存在');
    return structuredClone(record);
  }

  mutate(operation) {
    const result = this.mutations.then(async () => { await this.init(); return operation(); });
    this.mutations = result.catch(() => {});
    return result;
  }

  async save(records) {
    const content = JSON.stringify({ version: 1, deviceId: this.deviceId, conversations: [...records.values()] });
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw terminalError(429, '终端会话记录容量已达上限');
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const file = await fs.open(temporary, 'wx', 0o600);
      try {
        await file.writeFile(content);
        await file.sync();
      } finally { await file.close(); }
      await fs.rename(temporary, this.filePath);
      this.records = records;
    } finally { await fs.rm(temporary, { force: true }); }
  }

  create(input) {
    return this.mutate(async () => {
      if (this.records.size >= TERMINAL_CONVERSATION_LIMIT) throw terminalError(429, '终端会话数量已达上限');
      const timestamp = this.now().toISOString();
      const record = terminalConversationRecord({ ...input, id: this.idFactory(), provider: 'terminal', deviceId: this.deviceId,
        pinned: false, archived: false, createdAt: timestamp, updatedAt: timestamp, revision: 1 }, this.deviceId);
      if (this.records.has(record.id)) throw terminalError(409, '终端会话标识已存在');
      const records = new Map(this.records); records.set(record.id, record);
      await this.save(records); return structuredClone(record);
    });
  }

  update(id, expectedRevision, changes) {
    return this.mutate(async () => {
      const current = this.records.get(id);
      if (!current) throw terminalError(404, '终端会话不存在');
      if (current.revision !== expectedRevision) throw terminalError(409, '会话已变更，请刷新后重试');
      const record = terminalConversationRecord({ ...current, ...changes,
        revision: current.revision + 1, updatedAt: this.now().toISOString() }, this.deviceId);
      const records = new Map(this.records); records.set(id, record);
      await this.save(records); return structuredClone(record);
    });
  }
}
