import { TerminalConversationStore } from './terminal-conversation-store.mjs';
import { terminalConversationCreate, terminalConversationUpdate, terminalConversationId } from './terminal-conversation-contract.mjs';
import { terminalError } from './terminal-contract.mjs';
import { hasClaudeTranscript } from './terminal-conversation-transcript.mjs';

export class TerminalConversationService {
  constructor({ terminalService, filePath, deviceId, validateProject = async () => false, store,
    transcriptExists = hasClaudeTranscript } = {}) {
    this.terminalService = terminalService; this.deviceId = deviceId; this.validateProject = validateProject;
    this.store = store || new TerminalConversationStore({ filePath, deviceId }); this.transcriptExists = transcriptExists;
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

  async list() {
    const records = await this.store.list();
    return { conversations: records.map(record => this.present(record)), deviceId: this.deviceId,
      defaultCwd: this.terminalService.defaultCwd };
  }

  async open({ id }) { return this.present(await this.store.get(terminalConversationId(id))); }

  async create(input) {
    const normalized = terminalConversationCreate(input);
    await this.terminalService.validateCwd(normalized.cwd); await this.project(normalized.projectRef, normalized.cwd);
    const record = await this.store.create(normalized);
    try { return await this.start({ id: record.id }); }
    catch (error) { this.runtimeErrors.set(record.id, error.message); return this.present(await this.store.get(record.id)); }
  }

  exclusive(id, operation) {
    const result = (this.operations.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.operations.set(id, result);
    result.then(() => { if (this.operations.get(id) === result) this.operations.delete(id); },
      () => { if (this.operations.get(id) === result) this.operations.delete(id); });
    return result;
  }

  start({ id }) {
    id = terminalConversationId(id);
    return this.exclusive(id, async () => {
      const record = await this.store.get(id), existing = this.runtime(record);
      if (record.archived) throw terminalError(409, '请先恢复已归档的会话');
      if (existing?.status === 'running') return this.present(await this.store.get(record.id));
      if (existing) { await this.terminalService.close(existing.id); this.runtimes.delete(id); }
      let options = {};
      if (record.kind === 'claude') options = { claudeSessionId: id,
        resume: await this.transcriptExists({ userHome: this.terminalService.userHome, sessionId: id }) };
      try {
        const session = await this.terminalService.createManaged({ cwd: record.cwd, kind: record.kind }, options);
        this.runtimes.set(id, session.id); this.runtimeErrors.delete(id);
        return this.present(await this.store.get(record.id));
      } catch (error) { this.runtimeErrors.set(id, error.message); throw error; }
    });
  }

  async update(input) {
    const { id, expectedRevision, changes } = terminalConversationUpdate(input);
    const record = await this.store.get(id);
    if (Object.hasOwn(changes, 'projectRef')) await this.project(changes.projectRef, record.cwd);
    return this.present(await this.store.update(id, expectedRevision, changes));
  }

  stop({ id }) {
    id = terminalConversationId(id);
    return this.exclusive(id, async () => {
      const record = await this.store.get(id), runtime = this.runtime(record);
      if (runtime) await this.terminalService.close(runtime.id);
      this.runtimes.delete(id); this.runtimeErrors.delete(id); return this.present(await this.store.get(record.id));
    });
  }
}
