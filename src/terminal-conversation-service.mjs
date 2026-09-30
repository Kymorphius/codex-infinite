import { TerminalConversationStore } from './terminal-conversation-store.mjs';
import { terminalConversationCreate, terminalConversationUpdate, terminalConversationId } from './terminal-conversation-contract.mjs';
import { terminalError } from './terminal-contract.mjs';
import { hasClaudeTranscript } from './terminal-conversation-transcript.mjs';
import { createClaudeTranscriptReader, DEFAULT_CLAUDE_TITLE } from './claude-transcript.mjs';
import { createClaudeSessionOccupancy } from './claude-session-occupancy.mjs';
import { createClaudeSessionTakeover } from './claude-session-takeover.mjs';
import { createClaudeSettingsApplier } from './claude-terminal-settings-apply.mjs';
import { adoptClaudeSettings, observedClaudeSettings } from './claude-transcript-settings.mjs';
import { locateClaudeTranscript, readClaudeMirror } from './claude-mirror.mjs';
import { createClaudeMirrorTurns } from './claude-mirror-turn.mjs';

const claudeStatusOf = holders => holders.some(item => item.status === 'busy') ? 'busy' : holders.some(item => item.status === 'idle') ? 'idle' : null;
// Who else holds a Claude session that is not running here (see view).
const occupantOf = (record, holders, running) => running || !holders.length ? null
  : record.companionOf && holders.some(item => item.codexTurn) ? 'codex' : holders.every(item => item.jobId) ? 'background' : 'terminal';

const READ_ONLY = { companion: '伴生会话的模型由 Router 决定，此处只读', attach: '后台共享打开的会话沿用它启动时的模型，此处只读',
  elsewhere: '会话正在其他 Claude 进程中运行，此处只读；在这里打开后再选择' };

// Start (ms) of the newest live Claude holding the session (0 if unknown), or null when none runs.
const runningSince = holders => holders.length ? Math.max(0, ...holders.map(item => item.startedAt || 0)) : null;

export class TerminalConversationService {
  constructor({ terminalService, filePath, deviceId, validateProject = async () => false, store,
    transcriptExists = hasClaudeTranscript, claudeTranscripts, claudeOccupancy, claudeTakeover, companions = null, codexTitle = async () => '', companionCreator = null,
    claudeSettings, mirrorTurns, now = () => new Date() } = {}) {
    this.companions = companions; this.codexTitle = codexTitle; this.currentCompanions = null; this.companionCreator = companionCreator;
    this.terminalService = terminalService; this.deviceId = deviceId; this.validateProject = validateProject;
    this.store = store || new TerminalConversationStore({ filePath, deviceId }); this.transcriptExists = transcriptExists;
    this.claudeTranscripts = claudeTranscripts || (terminalService?.userHome ? createClaudeTranscriptReader({ userHome: terminalService.userHome })
      : { summary: async () => ({ title: '', lastUserMessageAt: null }), search: async () => null });
    this.claudeOccupancy = claudeOccupancy || (terminalService?.userHome ? createClaudeSessionOccupancy({ userHome: terminalService.userHome }) : async () => null);
    this.claudeTakeover = claudeTakeover || (this.claudeOccupancy.all ? createClaudeSessionTakeover({ holders: this.claudeOccupancy.all }) : null);
    this.mirrorTurns = mirrorTurns || (terminalService?.userHome ? createClaudeMirrorTurns({ userHome: terminalService.userHome, holders: ids => this.holders(ids) }) : null);
    this.runtimes = new Map(); this.operations = new Map(); this.runtimeErrors = new Map(); this.launches = new Map(); this.now = now;
    this.claudeSettings = claudeSettings || createClaudeSettingsApplier({ inspect: id => this.claudeRuntimeState(id),
      write: (runtimeId, data) => this.terminalService.write(runtimeId, data), inputLine: runtimeId => this.terminalService.inputLine(runtimeId) });
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
  async view(record, listingHolders = null) {
    if (record.kind !== 'claude') return this.present(record);
    let summary = { title: '', lastUserMessageAt: null, ids: [record.id] };
    try { summary = await this.claudeTranscripts.summary(record.id); } catch { /* Keep stored metadata when the transcript is unreadable. */ }
    record = await this.syncClaudeSettings(record, summary.settings || {});
    const presented = this.present(record);
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
    const holders = await (listingHolders ? listingHolders(summary.ids || [record.id]) : this.holders(summary.ids || [record.id])), running = presented.status === 'running';
    // A companion held by Router's per-turn process is mid Codex turn: read-only here until it ends.
    const occupiedBy = occupantOf(record, holders, running);
    return { ...presented, title, lastUserMessageAt: summary.lastUserMessageAt || null, occupiedElsewhere: Boolean(occupiedBy), occupiedBy, claudeStatus: claudeStatusOf(holders),
      claudeObserved: observedClaudeSettings(summary.settings || {}, { runningSince: runningSince(holders) }), claudeSettingsPending: this.claudeSettings.pending(record.id), claudeSettingsReadOnly: this.claudeSettingsReadOnly(record, occupiedBy) };
  }

  // Model choice is Router's for a companion, the job owner's for an attached background session,
  // and the other process's while one holds the session (nothing here could type it, and that
  // process's replies would read back over it).
  claudeSettingsReadOnly(record, occupiedBy) {
    return record.companionOf ? 'companion' : this.launches.get(record.id)?.attach && this.runtime(record)?.status === 'running' ? 'attach'
      : occupiedBy ? 'elsewhere' : null;
  }

  // A change made inside Claude (newer than the stored choice) is written back; see claude-transcript-settings.
  async syncClaudeSettings(record, observed) {
    if (record.companionOf || !record.claudeSettings || this.claudeSettings.settling(record.id)) return record;
    const adopted = adoptClaudeSettings(record.claudeSettings, observed);
    if (!adopted) return record;
    try {
      const saved = await this.store.update(record.id, record.revision, { claudeSettings: adopted }, { touch: false });
      this.claudeSettings.observed(record.id, adopted); return saved;
    } catch { return record; /* A concurrent write wins; the next view retries. */ }
  }

  // For the settings applier: our own non-attached running Claude, its busy/idle state and input line.
  async claudeRuntimeState(id) {
    const runtimeId = this.runtimes.get(id), runtime = runtimeId && this.terminalService.list().sessions.find(session => session.id === runtimeId);
    if (!runtime || runtime.status !== 'running' || this.launches.get(id)?.attach) return null;
    let ids = [id];
    try { ids = (await this.claudeTranscripts.summary(id)).ids || ids; } catch { /* Check the managed id alone. */ }
    // Idle only when every holder says so: Claude reports "waiting" while a menu, dialog or prompt is open.
    const holders = await this.holders(ids), status = claudeStatusOf(holders);
    return { runtimeId, claudeStatus: status === 'idle' && !holders.every(item => item.status === 'idle') ? null : status,
      inputLine: this.terminalService.inputLine(runtimeId) };
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

  // Router seeds a companion Claude session for a Codex thread that has none (idempotent:
  // an existing one is returned). The record then comes from the usual adoption.
  createCompanion({ threadId }) {
    if (!this.companions || !this.companionCreator) throw terminalError(503, '伴生 Claude 会话不可用');
    return this.exclusive(`companion:${threadId}`, async () => {
      const { sessionId } = await this.companionCreator.create(threadId);
      await this.syncCompanions();
      const record = await this.store.get(sessionId).catch(() => null);
      if (!record || record.companionOf !== threadId) throw terminalError(502, '伴生 Claude 会话已创建，但尚未出现在会话列表中，请稍后刷新');
      return this.view(record);
    });
  }

  async list() {
    await this.syncCompanions();
    const records = (await this.store.list()).filter(record => !this.superseded(record));
    let snapshot = null;
    const listingHolders = typeof this.claudeOccupancy.snapshot === 'function' ? async ids => {
      try {
        // Lazily share only this list's scan, including synchronous failures. Actions never use it.
        const read = await (snapshot ||= Promise.resolve().then(() => this.claudeOccupancy.snapshot()));
        return await read(ids);
      } catch { return []; }
    } : null;
    return { conversations: await Promise.all(records.map(record => this.view(record, listingHolders))), deviceId: this.deviceId,
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
          options = { claudeSessionId: target, resume: target !== id || await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: id, withMessages: false }),
            claudeSettings: record.claudeSettings || null };
        }
      }
      try {
        const session = await this.terminalService.createManaged({ cwd: record.cwd, kind: record.kind }, options);
        this.runtimes.set(id, session.id); this.runtimeErrors.delete(id); this.launches.set(id, { attach: Boolean(options.attachJob) });
        // Ultracode has no launch flag: the applier restores it once the new Claude is first idle.
        if (record.kind === 'claude' && !options.attachJob) this.claudeSettings.launched(id, session.id, record.claudeSettings || null);
        else this.claudeSettings.stopped(id);
        return this.view(await this.store.get(record.id));
      } catch (error) { this.runtimeErrors.set(id, error.message); throw error; }
    });
  }

  async update(input) {
    const { id, expectedRevision, changes } = terminalConversationUpdate(input);
    // A model choice runs after any start in progress, so it is queued for the Claude that start launched.
    const apply = async () => {
      const record = await this.store.get(id);
      if (Object.hasOwn(changes, 'projectRef')) await this.project(changes.projectRef, record.cwd);
      if (changes.claudeSettings) {
        if (record.kind !== 'claude') throw terminalError(400, '只有 Claude 会话可以设置模型');
        const readOnly = this.claudeSettingsReadOnly(record, await this.occupant(record));
        if (readOnly) throw terminalError(409, READ_ONLY[readOnly]);
        changes.claudeSettings = { ...changes.claudeSettings, updatedAt: this.now().toISOString() };
      }
      const updated = await this.store.update(id, expectedRevision, changes);
      // Running here: typed into Claude once it is safe; stopped: the next launch passes the flags.
      if (changes.claudeSettings) this.claudeSettings.request(id, updated.claudeSettings);
      return this.view(updated);
    };
    return changes.claudeSettings ? this.exclusive(id, apply) : apply();
  }

  // Companion mirror (docs/specs/2026-09-29-claude-companion-mirror.md): the chain's live transcript.
  async companionTarget(id) {
    const record = await this.store.get(terminalConversationId(id));
    if (record.kind !== 'claude' || !record.companionOf) throw terminalError(400, '只有伴生 Claude 会话提供镜像');
    let ids = [record.id], resumeId = null;
    try { const chain = await this.claudeTranscripts.summary(record.id); ids = chain.ids || ids; resumeId = chain.resumeId || null; } catch { /* The managed id alone. */ }
    const target = resumeId && await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: resumeId }) ? resumeId : record.id;
    return { record, ids, target };
  }

  async mirror({ id, cursor }) {
    const { record, ids, target } = await this.companionTarget(id);
    const result = await readClaudeMirror({ file: await locateClaudeTranscript(this.terminalService.userHome, target), sessionId: target, cursor });
    return { ...result, turn: this.mirrorTurns?.state(record.id) || null, occupiedBy: occupantOf(record, await this.holders(ids), this.runtime(record)?.status === 'running') };
  }

  async mirrorSend({ id, text }) {
    const { record, ids, target } = await this.companionTarget(id);
    if (this.runtime(record)?.status === 'running') throw terminalError(409, '交互模式运行中，请直接在终端里输入');
    if (!this.mirrorTurns) throw terminalError(503, '镜像发送不可用');
    return { turn: this.mirrorTurns.send({ id: record.id, ids, target, cwd: record.cwd, text }) };
  }

  async occupant(record) {
    let ids = [record.id];
    try { ids = (await this.claudeTranscripts.summary(record.id)).ids || ids; } catch { /* Check the managed id alone. */ }
    return occupantOf(record, await this.holders(ids), this.runtime(record)?.status === 'running');
  }

  stop({ id }) {
    id = terminalConversationId(id);
    return this.exclusive(id, async () => {
      const record = await this.store.get(id), runtime = this.runtime(record);
      if (runtime) await this.terminalService.close(runtime.id);
      this.runtimes.delete(id); this.runtimeErrors.delete(id); this.launches.delete(id); this.claudeSettings.stopped(id);
      return this.view(await this.store.get(record.id));
    });
  }
}
