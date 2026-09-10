import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { projectGptMessage } from './gpt-context-transcript.mjs';

const ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREFIX = 'codex:';
const seconds = value => Math.floor(Date.parse(value) / 1000) || 0;
export function sourceId(id) {
  if (!ID.test(id || '')) throw new Error('Invalid source identity');
  return PREFIX + id.toLowerCase();
}
export function ownerId(id) {
  if (typeof id !== 'string' || !id.startsWith(PREFIX) || !ID.test(id.slice(PREFIX.length))) throw new Error('Invalid shared conversation identity');
  return id.slice(PREFIX.length).toLowerCase();
}
export function sessionProjection(item) {
  return { id: sourceId(item.id), title: item.title, cwd: item.cwd, git_repo_root: item.cwd,
    source: 'codex', profile: 'default', is_default_profile: true, archived: item.archived,
    started_at: seconds(item.createdAt), last_active: seconds(item.updatedAt), ended_at: null,
    is_active: false, message_count: 1, input_tokens: 0, output_tokens: 0, tool_call_count: 0,
    model: null, preview: null, shared_source: { conversationId: item.id, projectId: item.projectId } };
}

// Read a fixed byte snapshot. Partial trailing writes are omitted until the next
// read, never interpreted as complete records. No database or transcript writes.
export async function readSharedMessages(file, { limit = 500, offset = 0, order = 'latest' } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0 || !['latest', 'oldest'].includes(order)) throw new Error('Invalid message page');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('Conversation history exceeds the supported read size');
    const messages = [];
    let activeTurnId = null, activeTurnStartedAt = null;
    let pending = Buffer.alloc(0), byteOffset = 0, position = 0;
    while (position < stat.size) {
      const chunk = Buffer.alloc(Math.min(65536, stat.size - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead !== chunk.length) throw new Error('Conversation changed during read; refresh required');
      position += bytesRead; pending = Buffer.concat([pending, chunk]);
      let end;
      while ((end = pending.indexOf(10)) >= 0) {
        const line = pending.subarray(0, end);
        if (line.length) {
          let record;
          try { record = JSON.parse(line.toString('utf8')); } catch { throw new Error('Malformed conversation record'); }
          if (record.type === 'event_msg' && record.payload?.type === 'task_started' && ID.test(record.payload.turn_id || '')) {
            activeTurnId = record.payload.turn_id; activeTurnStartedAt = seconds(record.timestamp) || null;
          }
          if (record.type === 'event_msg' && record.payload?.type === 'task_complete' && record.payload.turn_id === activeTurnId) {
            activeTurnId = null; activeTurnStartedAt = null;
          }
          let message = projectGptMessage(record, byteOffset, { maxMessageChars: Infinity, includeCommentary: true });
          const content = record?.payload?.content;
          const images = record?.type === 'response_item' && record?.payload?.role === 'user' && Array.isArray(content)
            ? content.filter(part => ['input_image', 'image_url', 'local_image'].includes(part?.type)).length : 0;
          if (images) {
            message ||= { id: record.payload.id || `byte:${byteOffset}`, role: 'user', timestamp: record.timestamp, phase: null, text: '' };
            message = { ...message, text: `${message.text}\n[${images} 个图片附件，请在 GPT 原会话中查看]`.trim() };
          }
          if (message) messages.push({ id: byteOffset + 1, role: message.role,
            content: message.role === 'user' ? message.text.replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, '$1') : message.text,
            timestamp: seconds(message.timestamp), source_message_id: message.id, source_phase: message.phase, source_turn_id: activeTurnId });
        }
        byteOffset += end + 1; pending = pending.subarray(end + 1);
      }
      if (pending.length > 32 * 1024 * 1024) throw new Error('Conversation record exceeds supported size');
    }
    const start = order === 'latest' ? Math.max(0, messages.length - offset - limit) : offset;
    const end = order === 'latest' ? Math.max(0, messages.length - offset) : offset + limit;
    return { messages: messages.slice(start, end), total: messages.length, activeTurnId, activeTurnStartedAt,
      revision: `${stat.dev}:${stat.ino}:${byteOffset}`, pagination: { limit, offset, order, returned: messages.slice(start, end).length } };
  } finally { await handle.close(); }
}

export class HermesSharedSource {
  constructor({ catalog, messages = readSharedMessages, remoteMessageService, nativeConversationAdapter, now = Date.now }) {
    this.catalog = catalog; this.messages = messages; this.remoteMessageService = remoteMessageService;
    this.nativeConversationAdapter = nativeConversationAdapter;
    this.now = now;
  }
  async snapshot() {
    const value = await this.catalog.snapshot();
    if (value.truncated) throw new Error('Project catalogue exceeds the supported size');
    return { ...value, conversations: value.conversations.filter(item => !item.internal) };
  }
  async list() {
    const snapshot = await this.snapshot();
    return { projects: snapshot.projects, sessions: snapshot.conversations.map(sessionProjection) };
  }
  async find(id) {
    const original = ownerId(id), snapshot = await this.snapshot();
    const item = snapshot.conversations.find(item => item.id.toLowerCase() === original);
    if (!item) throw new Error('Shared conversation no longer available');
    return item;
  }
  async history(id, page) {
    const item = await this.find(id);
    let file;
    try { file = await this.catalog.transcriptPath(item); }
    catch (error) {
      if (!this.readNativeThread) throw error;
      const result = await this.readNativeThread(item.id);
      if (!Array.isArray(result.thread?.turns) || result.thread.turns.length) throw error;
      return { session_id: id, messages: [], total: 0, activeTurnId: null, revision: "native-empty", pagination: { limit: page?.limit || 500, offset: page?.offset || 0, order: page?.order || "latest", returned: 0 } };
    }
    let history = await this.messages(file, page);
    // A process crash can leave task_started without task_complete. Only an
    // explicitly idle native owner may settle an old marker; unknown/active
    // status remains conservative. The grace avoids fresh-turn UI lag.
    if (history.activeTurnId && history.activeTurnStartedAt && this.now() / 1000 - history.activeTurnStartedAt >= 60 &&
        this.nativeConversationAdapter?.readThreadStatuses) {
      const statuses = await this.nativeConversationAdapter.readThreadStatuses().catch(() => new Map());
      if (statuses.get(item.id) === 'completed') {
        const latest = await this.messages(file, page);
        if (latest.activeTurnId === history.activeTurnId && latest.revision === history.revision) {
          history = { ...latest, interruptedTurnId: latest.activeTurnId, activeTurnId: null,
            revision: `${latest.revision}:owner-idle` };
        } else history = latest;
      }
    }
    return { ...history, session_id: sourceId(item.id) };
  }
  async interrupt(id, turnId) {
    const item = await this.find(id), history = await this.history(id);
    if (!turnId || history.activeTurnId !== turnId) throw new Error('当前执行轮次已变化，请刷新后停止。');
    if (!this.nativeConversationAdapter) throw new Error('Native owner control is unavailable');
    return this.nativeConversationAdapter.interruptTurn({ threadId: item.id, turnId });
  }
  async send(id, text, { queued = false, attachments = [] } = {}) {
    const item = await this.find(id);
    if (item.archived) throw new Error('Restore the archived conversation in GPT before continuing');
    if (!this.remoteMessageService) throw new Error('Native owner sending service is unavailable');
    const running = queued && (await this.nativeConversationAdapter.readThreadStatuses({ strict: true })).get(item.id) === 'active';
    return this.remoteMessageService.submit({ threadId: item.id, prompt: text, expectedDraftRevision: null, deliveryMode: running ? 'queue' : 'new-turn', attachments });
  }
}
