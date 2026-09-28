import { TerminalConversationStore } from './terminal-conversation-store.mjs';
import { terminalConversationCreate, terminalConversationUpdate, terminalConversationId } from './terminal-conversation-contract.mjs';
import { terminalError } from './terminal-contract.mjs';
import { hasClaudeTranscript } from './terminal-conversation-transcript.mjs';
import { createClaudeTranscriptReader, DEFAULT_CLAUDE_TITLE } from './claude-transcript.mjs';
import { createClaudeSessionOccupancy } from './claude-session-occupancy.mjs';
import { createClaudeSessionTakeover } from './claude-session-takeover.mjs';

export class TerminalConversationService {
  constructor({ terminalService, filePath, deviceId, validateProject = async () => false, store,
    transcriptExists = hasClaudeTranscript, claudeTranscripts, claudeOccupancy, claudeTakeover, companions = null, codexTitle = async () => '' } = {}) {
    this.companions = companions; this.codexTitle = codexTitle; this.currentCompanions = null;
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
    // A Router companion is the Claude side of a Codex conversation: it carries that
    // conversation's name (or a /rename), never a title generated from Router's prompts.
    const title = record.title !== DEFAULT_CLAUDE_TITLE ? presented.title
      : record.companionOf ? summary.customTitle || await this.codexTitleOf(record.companionOf) || presented.title
      : summary.title || presented.title;
    // Like native conversations in use elsewhere, a Claude session another Claude process
    // holds is read-only here and cannot be started a second time.
    // A session held only by Claude background jobs can be opened here (attach) and
    // shared; one held by a terminal window needs an explicit takeover.
    // Holders include our own running Claude; their registration also carries Claude's
    // busy/idle state, shown next to the conversation in 最近会话 / 最近发送.
    const holders = await this.holders(summary.ids || [record.id]), running = presented.status === 'running';
    // A companion held by Router's per-turn process is mid Codex turn: read-only here until it ends.
    const occupiedBy = running || !holders.length ? null : record.companionOf && holders.some(item => item.codexTurn) ? 'codex'
      : holders.every(item => item.jobId) ? 'background' : 'terminal';
    const claudeStatus = holders.some(item => item.status === 'busy') ? 'busy' : holders.some(item => item.status === 'idle') ? 'idle' : null;
    return { ...presented, title, lastUserMessageAt: summary.lastUserMessageAt || null, occupiedElsewhere: Boolean(occupiedBy), occupiedBy, claudeStatus };
  }

  async codexTitleOf(threadId) {
    try { return String(await this.codexTitle(threadId) || '').slice(0, 160); } catch { return ''; }
  }

  // Router replaced this companion's Claude session: keep the record, stop showing it.
  superseded(record) {
    const current = record.companionOf && this.currentCompanions?.get(record.companionOf);
    return Boolean(current && current !== record.id);
  }

  async holders(ids) {
    try {
      if (this.claudeOccupancy.all) return await this.claudeOccupancy.all(ids);
      const first = await this.claudeOccupancy(ids); return first ? [first] : [];
    } catch { return []; }
  }

  // Messages you sent in managed Claude conversations, newest first; archived ones excluded.
  async searchSent(query) {
    const records = (await this.store.list()).filter(record => record.kind === 'claude' && !record.archived && !this.superseded(record));
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

  // Router companion sessions become Claude records keyed by their Claude session ID and
  // shown under their Codex conversation. Adoption never rewrites an existing record.
  async syncCompanions() {
    if (!this.companions) return;
    let found = [];
    try { found = await this.companions.list(); } catch { return; }
    this.currentCompanions = new Map(found.map(companion => [companion.threadId, companion.sessionId]));
    for (const companion of found) {
      try {
        const record = await this.store.adopt({ id: companion.sessionId, cwd: companion.cwd, kind: 'claude', title: DEFAULT_CLAUDE_TITLE,
          projectRef: null, companionOf: companion.threadId });
        if (record.cwd !== companion.cwd) await this.store.relocateCompanion(record.id, companion.cwd);
      } catch { /* One unreadable or over-limit companion must not hide the rest. */ }
    }
  }

  async list() {
    await this.syncCompanions();
    const records = (await this.store.list()).filter(record => !this.superseded(record));
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
        const holders = await this.holders(ids), jobs = holders.filter(item => item.jobId);
        // Never take over a Codex turn: that would kill Router's process mid-reply.
        if (record.companionOf && holders.some(item => item.codexTurn)) throw terminalError(409, 'Codex 正在用这个 Claude 会话回复，本轮结束后再打开');
        if (holders.length && jobs.length === holders.length) {
          // Held only by Claude background jobs: attach to the live one and share it. Stopping
          // and resuming instead lets Claude's own viewers restart it and fork a copy.
          options = { attachJob: (jobs.find(item => item.sessionId === resumeId) || jobs[0]).jobId };
        } else {
          if (holders.length && !(takeover === true && this.claudeTakeover)) throw terminalError(409, `会话正在其他 Claude 窗口中运行（进程 ${holders[0].pid}），请先在那里退出`);
          // Explicit takeover ends the other Claude processes, then resumes here.
          if (holders.length) await this.claudeTakeover(ids);
          // Resume the chain's live transcript, not the managed id (see claude-transcript resumeId).
          const target = resumeId && await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: resumeId }) ? resumeId : id;
          options = { claudeSessionId: target, resume: target !== id || await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: id }) };
        }
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
