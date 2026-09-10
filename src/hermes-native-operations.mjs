import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { ownerId, sourceId } from './hermes-shared-source.mjs';

// Requests run through the already authenticated native desktop process.
// Never start a second app-server writer or edit native index files.
export class HermesNativeOperations {
  constructor({ source, native, settingsAdapter }) {
    this.source = source; this.native = native; this.settingsAdapter = settingsAdapter;
  }
  async request(method, params) {
    const allowed = ['thread/start', 'thread/read', 'thread/name/set', 'thread/archive', 'thread/unarchive', 'model/list'];
    if (!allowed.includes(method)) throw new Error('Unsupported native operation');
    const connection = await this.native.connect(), id = 'hermes-operation-' + crypto.randomUUID();
    try {
      const value = await connection.evaluate(`(async () => {
        const id=${JSON.stringify(id)}, method=${JSON.stringify(method)}, params=${JSON.stringify(params)};
        return new Promise(resolve => {
          const finish = result => {clearTimeout(timer);window.removeEventListener('message',receive);resolve(result)};
          const receive = event => {const data=event.data;if(data?.type==='mcp-response'&&data?.hostId==='local'&&data.message?.id===id)finish(data.message)};
          const timer=setTimeout(()=>finish({error:{message:'原生请求超时；结果可能未知，请查看原会话，勿重复操作。'}}),20000);
          window.addEventListener('message',receive);
          try {window.electronBridge.sendMessageFromView({type:'mcp-request',hostId:'local',retainResponse:true,request:{id,method,params}})}
          catch(error){finish({error:{message:String(error.message)}})}
        });
      })()`);
      if (value?.error) throw new Error(value.error.message);
      if (!value || !Object.hasOwn(value, 'result')) throw new Error('原生操作结果未知，请查看原会话。');
      return value.result;
    } finally { await connection.close(); }
  }
  async create({ project_id, title = '新建 GPT 会话' }) {
    const value = await this.source.list();
    const project = value.projects.find(p => 'codex:' + p.id === project_id);
    const cwd = project?.directories[0];
    if (!project || !cwd || !(await fs.stat(cwd)).isDirectory()) throw new Error('GPT 项目目录不可用');
    if (typeof title !== 'string' || !title.trim() || title.length > 300) throw new Error('会话标题无效');
    const created = await this.request('thread/start', { cwd, projectId: project.id, ephemeral: false });
    const id = sourceId(created.thread?.id);
    try { await this.request('thread/name/set', { threadId: ownerId(id), name: title.trim() }); }
    catch { return { id, title: created.thread?.name || '新建 GPT 会话', cwd, warning: '会话已创建，但标题未保存，请勿重复创建。' }; }
    return { id, title: title.trim(), cwd };
  }
  async read(id) {
    const item = await this.source.find(id);
    const [result, models, approvals] = await Promise.all([
      this.request('thread/read', { threadId: item.id, includeTurns: false }),
      this.request('model/list', { limit: 100 }), this.native.readPendingApprovals(item.id, { strict: true })
    ]);
    return { id, title: result.thread.name || item.title, archived: item.archived,
      model: result.thread.model, reasoningEffort: result.thread.reasoningEffort,
      models: models.data.map(m => ({ id: m.model || m.id, name: m.displayName || m.id,
        efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort), defaultEffort: m.defaultReasoningEffort })), approvals };
  }
  async change(id, input) {
    const item = await this.source.find(id);
    if (input.action === 'rename') {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300) throw new Error('会话标题无效');
      await this.request('thread/name/set', { threadId: item.id, name: input.title.trim() });
    } else if (['archive', 'restore'].includes(input.action)) {
      const statuses = await this.native.readThreadStatuses({ strict: true });
      if (statuses.get(item.id) === 'active') throw new Error('请先等待会话完成，再归档或恢复。');
      await this.request(input.action === 'archive' ? 'thread/archive' : 'thread/unarchive', { threadId: item.id });
    } else if (input.action === 'settings') {
      const state = await this.read(id), model = state.models.find(m => m.id === input.model);
      if (!model || !model.efforts.includes(input.reasoningEffort)) throw new Error('原生模型或推理强度无效，请刷新选项。');
      await this.settingsAdapter.apply({ threadId: item.id, changes: { model: input.model, reasoningEffort: input.reasoningEffort } });
    } else if (input.action === 'approval') {
      await this.native.resolveApproval({ threadId: item.id, turnId: input.turnId, approvalToken: input.token, decision: input.decision });
    } else throw new Error('Unsupported shared operation');
    return this.read(id);
  }
}
