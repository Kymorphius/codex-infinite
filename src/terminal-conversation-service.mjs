import { TerminalConversationStore } from './terminal-conversation-store.mjs';
import { terminalConversationCreate, terminalConversationUpdate, terminalConversationId } from './terminal-conversation-contract.mjs';
import { terminalError } from './terminal-contract.mjs';
import { hasClaudeTranscript } from './terminal-conversation-transcript.mjs';
import { createClaudeTranscriptReader, DEFAULT_CLAUDE_TITLE } from './claude-transcript.mjs';
import { createClaudeSessionOccupancy } from './claude-session-occupancy.mjs';
import { createClaudeSessionTakeover } from './claude-session-takeover.mjs';

export class TerminalConversationService {
  constructor({ terminalService, filePath, deviceId, validateProject = async () => false, store,
    transcriptExists = hasClaudeTranscript, claudeTranscripts, claudeOccupancy, claudeTakeover } = {}) {
    this.terminalService = terminalService; this.deviceId = deviceId; this.validateProject = validateProject;
    this.store = store || new TerminalConversationStore({ filePath, deviceId }); this.transcriptExists = transcriptExists;
    this.claudeTranscripts = claudeTranscripts || (terminalService?.userHome ? createClaudeTranscriptReader({ userHome: terminalService.userHome })
      : { summary: async () => ({ title: '', lastUserMessageAt: null }), search: async () => null });
    this.claudeOccupancy = claudeOccupancy || (terminalService?.userHome ? createClaudeSessionOccupancy({ userHome: terminalService.userHome }) : async () => null);
    this.claudeTakeover = claudeTakeover || (this.claudeOccupancy.all ? createClaudeSessionTakeover({ holders: this.claudeOccupancy.all }) : null);
    this.runtimes = new Map(); this.operations = new Map(); this.runtimeErrors = new Map();
  }

  project(reference, cwd) {
    return reference === null ? Promise.resolve() : Promise.resolve(this.validateProject(reference, cwd)).then(valid => {
      if (valid !== true) throw terminalError(400, '请选择本机项目及其明确的工作目录');
    });
  }

  runtime(record) {
    const id = this.runtimes.get(record.id);
    return id ? this.terminalService.list().sessions.find(session => session.id === id) || null : null;
  }

  present(record) {
    const runtimeSummary = this.runtime(record);
    return { ...record, runtimeSessionId: runtimeSummary?.id || null, runtimeSummary,
      status: runtimeSummary?.status || 'stopped', runtimeError: this.runtimeErrors.get(record.id) || null };
  }

  // Claude conversations follow Claude's own transcript: its title (/rename, else
  // generated) while the stored title is still the default, and the time of the last
  // message you sent. A title set here always wins; the store is unchanged.
  async view(record) {
    const presented = this.present(record);
    if (record.kind !== 'claude') return presented;
    let summary = { title: '', lastUserMessageAt: null, ids: [record.id] };
    try { summary = await this.claudeTranscripts.summary(record.id); } catch { /* Keep stored metadata when the transcript is unreadable. */ }
    const title = record.title === DEFAULT_CLAUDE_TITLE && summary.title ? summary.title : presented.title;
    // Like native conversations in use elsewhere, a Claude session another Claude process
    // holds is read-only here and cannot be started a second time.
    const occupiedElsewhere = presented.status !== 'running' && Boolean(await this.occupant(summary.ids || [record.id]));
    return { ...presented, title, lastUserMessageAt: summary.lastUserMessageAt || null, occupiedElsewhere };
  }

  async occupant(ids) {
    try { return await this.claudeOccupancy(ids); } catch { return null; }
  }

  // Messages you sent in managed Claude conversations, newest first; archived ones excluded.
  async searchSent(query) {
    const records = (await this.store.list()).filter(record => record.kind === 'claude' && !record.archived);
    let failures = 0;
    const found = await Promise.all(records.map(async record => {
      try {
        const match = await this.claudeTranscripts.search(record.id, query);
        return match && { kind: 'terminal', id: record.id, deviceId: this.deviceId, title: (await this.view(record)).title, excerpt: match.excerpt, at: match.at };
      } catch { failures++; return null; }
    }));
    const items = found.filter(Boolean).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    return { items, incomplete: failures > 0 };
  }

  async list() {
    const records = await this.store.list();
    return { conversations: await Promise.all(records.map(record => this.view(record))), deviceId: this.deviceId,
      defaultCwd: this.terminalService.defaultCwd };
  }

  async open({ id }) { return this.view(await this.store.get(terminalConversationId(id))); }

  async create(input) {
    const normalized = terminalConversationCreate(input);
    await this.terminalService.validateCwd(normalized.cwd); await this.project(normalized.projectRef, normalized.cwd);
    const record = await this.store.create(normalized);
    try { return await this.start({ id: record.id }); }
    catch (error) { this.runtimeErrors.set(record.id, error.message); return this.view(await this.store.get(record.id)); }
  }

  exclusive(id, operation) {
    const result = (this.operations.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(id, result);
    result.then(() => { if (this.operations.get(id) === result) this.operations.delete(id); },
      () => { if (this.operations.get(id) === result) this.operations.delete(id); });
    return result;
  }

  start({ id, takeover = false }) {
    id = terminalConversationId(id);
    return this.exclusive(id, async () => {
      const record = await this.store.get(id), existing = this.runtime(record);
      if (record.archived) throw terminalError(409, '请先恢复已归档的会话');
      if (existing?.status === 'running') return this.view(await this.store.get(record.id));
      if (existing) { await this.terminalService.close(existing.id); this.runtimes.delete(id); }
      let options = {};
      if (record.kind === 'claude') {
        let ids = [id], resumeId = null;
        try { const chain = await this.claudeTranscripts.summary(id); ids = chain.ids || ids; resumeId = chain.resumeId || null; } catch { /* Check the managed id alone. */ }
        const occupant = await this.occupant(ids);
        if (occupant && !(takeover === true && this.claudeTakeover)) throw terminalError(409, `会话正在其他 Claude 窗口中运行（进程 ${occupant.pid}），请先在那里退出`);
        // Explicit takeover ends the other Claude processes, then resumes here.
        if (occupant) await this.claudeTakeover(ids);
        // Resume the chain's live transcript, not the managed id (see claude-transcript resumeId).
        const target = resumeId && await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: resumeId }) ? resumeId : id;
        options = { claudeSessionId: target, resume: target !== id || await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: id }) };
      }
      try {
        const session = await this.terminalService.createManaged({ cwd: record.cwd, kind: record.kind }, options);
        this.runtimes.set(id, session.id); this.runtimeErrors.delete(id);
        return this.view(await this.store.get(record.id));
      } catch (error) { this.runtimeErrors.set(id, error.message); throw error; }
    });
  }

  async update(input) {
    const { id, expectedRevision, changes } = terminalConversationUpdate(input);
    const record = await this.store.get(id);
    if (Object.hasOwn(changes, 'projectRef')) await this.project(changes.projectRef, record.cwd);
    return this.view(await this.store.update(id, expectedRevision, changes));
  }

  stop({ id }) {
    id = terminalConversationId(id);
    return this.exclusive(id, async () => {
      const record = await this.store.get(id), runtime = this.runtime(record);
      if (runtime) await this.terminalService.close(runtime.id);
      this.runtimes.delete(id); this.runtimeErrors.delete(id); return this.view(await this.store.get(record.id));
    });
  }
}
