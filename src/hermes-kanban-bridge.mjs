import fs from 'node:fs/promises';
import { canonicalDraftText } from './native-conversation-adapter.mjs';

const projectId = id => typeof id === 'string' && id.startsWith('codex:') ? id.slice(6) : null;
export class HermesKanbanBridge {
  constructor({ source, native, device, pause = ms => new Promise(r => setTimeout(r, ms)) }) {
    this.source = source; this.native = native; this.device = device; this.pause = pause;
  }
  project(row) {
    return { id: `codex:${row.id}`, slug: `codex-${row.id}`, name: row.name, primary_path: row.directories[0] || null,
      source: 'codex', device_id: this.device.id, device_name: this.device.name, engines: ['hermes', 'codex'] };
  }
  async projects() { return { projects: (await this.source.list()).projects.map(p => this.project(p)) }; }
  async resolve(params) {
    if (params.device_id && params.device_id !== this.device.id) throw new Error('执行设备已变化，请重新选择项目。');
    const value = await this.source.list(), row = value.projects.find(p => p.id === projectId(params.project_id));
    if (!row) throw new Error('原 GPT 项目已不存在，请重新选择。');
    const project = this.project(row);
    if (!params.conversation_id) return { project };
    const session = value.sessions.find(s => s.id === params.conversation_id && !s.archived && s.shared_source.projectId === row.id);
    if (!session) throw new Error('所选会话不属于这个项目，或已归档。');
    if (!session.cwd || !(await fs.stat(session.cwd)).isDirectory()) throw new Error('原会话工作目录不可用。');
    return { project, session: { id: session.id, title: session.title, cwd: session.cwd } };
  }
  async sessions(params) {
    const { project } = await this.resolve(params), value = await this.source.list();
    return { project, sessions: value.sessions.filter(s => !s.archived && `codex:${s.shared_source.projectId}` === project.id)
      .map(s => ({ id: s.id, title: s.title, cwd: s.cwd })) };
  }
  async inspect(params) {
    const target = await this.resolve(params), history = await this.source.history(target.session.id);
    return { ...target, revision: history.revision, active_turn_id: history.activeTurnId, messages: history.messages.map(m => ({
      id: m.id, role: m.role, text: m.content, phase: m.source_phase, turn_id: m.source_turn_id })) };
  }
  async send(params) {
    const { session } = await this.resolve(params);
    if (params.cwd !== session.cwd) throw new Error('原会话目录已变化，请重新核对执行目标。');
    if (typeof params.text !== 'string' || !params.text.trim() || params.text.length > 12000) throw new Error('任务内容为空或过长。');
    const before = await this.source.history(session.id);
    if (before.activeTurnId) throw new Error('原 GPT 会话仍在执行，请稍后运行此卡片。');
    await this.source.send(session.id, params.text);
    const existing = new Set(before.messages.map(m => m.id));
    for (let attempt = 0; attempt < 40; attempt++) {
      const history = await this.source.history(session.id);
      const sent = history.messages.find(m => !existing.has(m.id) && m.role === 'user' && canonicalDraftText(m.content) === canonicalDraftText(params.text));
      if (sent?.source_turn_id) return { accepted: true, conversation_id: session.id, turn_id: sent.source_turn_id, message_id: sent.id };
      await this.pause(250);
    }
    throw new Error('消息可能已经发送，但无法确认原执行轮次；不会自动重发，请查看原会话。');
  }
  async open(params) {
    const { session } = await this.resolve(params);
    return this.native.openConversation(session.id.slice(6));
  }
  async interrupt(params) {
    const { session } = await this.resolve(params);
    return this.source.interrupt(session.id, params.turn_id);
  }
}
