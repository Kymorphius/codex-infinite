import { randomUUID } from 'node:crypto';
import { httpError } from './http-utils.mjs';
import { DISCUSSION_LIMITS, discussionId, otherRole } from './discussion-contract.mjs';
import { planForward, applyForward } from './discussion-policy.mjs';

const ROLE_LABEL = { claude: 'Claude', gpt: 'GPT' };

// Application service for paired discussions. Ports (all injected):
//   participants[role].resolve(id) -> { cwd, title } | null       (existence and project)
//   participants[role].latestAnswer(id) -> { turnId, text, at } | null   (read-only)
//   participants[role].deliver(id, text)                           (throws httpError on refusal)
// Phase 1 is manual: a forward happens only when the person asks for it, once per answer.
export class DiscussionService {
  constructor({ store, participants, now = () => new Date(), idFactory = randomUUID } = {}) {
    this.store = store; this.participants = participants; this.now = now; this.idFactory = idFactory;
    this.locks = new Map();
  }

  exclusive(id, operation) {
    const result = (this.locks.get(id) || Promise.resolve()).catch(() => {}).then(operation);
    this.locks.set(id, result);
    const release = () => { if (this.locks.get(id) === result) this.locks.delete(id); };
    result.then(release, release);
    return result;
  }

  async list() { return { discussions: (await this.store.list()).map(view) }; }

  async get({ id }) { return { discussion: view(await this.store.get(id)) }; }

  // The live discussions one conversation takes part in, for the shortcut-bar button, with
  // both participants' titles so the menu can name the counterpart.
  async forConversation({ conversationId }) {
    const id = discussionId(conversationId);
    const found = (await this.store.list()).filter(item => item.status !== 'stopped' && item.participants.some(p => p.conversationId === id));
    return { discussions: await Promise.all(found.map(async item => {
      const titles = {};
      for (const { role, conversationId: participantId } of item.participants) titles[role] = (await this.participants[role].resolve(participantId).catch(() => null))?.title || '';
      return { ...view(item), titles };
    })) };
  }

  // Conversations of the other kind in the same directory that `conversationId` could pair with.
  async candidates({ conversationId, role }) {
    const self = await this.participants[role].resolve(conversationId);
    if (!self?.cwd) throw httpError(404, '当前会话不存在');
    const other = otherRole(role);
    const taken = new Set((await this.store.list()).filter(item => item.status !== 'stopped').flatMap(item => item.participants.map(p => p.conversationId)));
    const found = await this.participants[other].candidates(self.cwd);
    return { role: other, candidates: found.filter(item => !taken.has(item.id)).slice(0, 20) };
  }

  async create({ claudeConversationId, gptConversationId }) {
    const [claude, gpt] = await Promise.all([this.participants.claude.resolve(claudeConversationId), this.participants.gpt.resolve(gptConversationId)]);
    if (!claude) throw httpError(404, 'Claude 会话不存在');
    if (!gpt) throw httpError(404, 'GPT 会话不存在');
    if (!claude.cwd || normalizeDirectory(claude.cwd) !== normalizeDirectory(gpt.cwd)) throw httpError(409, 'Claude 和 GPT 会话必须在同一个项目目录里才能配对');
    const existing = (await this.store.list()).find(item => item.status !== 'stopped'
      && item.participants.some(p => p.conversationId === claudeConversationId) && item.participants.some(p => p.conversationId === gptConversationId));
    if (existing) return { discussion: view(existing) };
    const record = await this.store.create({ projectCwd: claude.cwd, participants: [
      { role: 'claude', provider: 'terminal', conversationId: claudeConversationId },
      { role: 'gpt', provider: 'codex', conversationId: gptConversationId }] });
    return { discussion: view(record) };
  }

  conversationOf(discussion, role) { return discussion.participants.find(item => item.role === role).conversationId; }

  // Preview of what "转给对方" would send now, so the person can comment on the right answer.
  async latest({ id, from }) {
    const discussion = await this.store.get(id);
    const answer = await this.participants[from].latestAnswer(this.conversationOf(discussion, from));
    return { answer: answer && { ...answer, forwarded: discussion.cursors[from] === answer.turnId }, pendingComments: discussion.pendingComments };
  }

  // A comment kept until the next forward, which carries it once and then clears it.
  comment({ id, text }) {
    return this.exclusive(id, async () => {
      const current = await this.store.get(id);
      if (current.status === 'stopped') throw httpError(409, '这个讨论已结束');
      if (current.pendingComments.length >= 20) throw httpError(429, '待发送的点评过多，请先转发');
      const at = this.now().toISOString();
      return { discussion: view(await this.store.update(id, current.revision, item => ({ ...item, updatedAt: at, revision: item.revision + 1,
        pendingComments: [...item.pendingComments, text],
        messages: [...item.messages, { id: this.idFactory(), at, kind: 'comment', from: 'user', to: 'both', text, sourceTurnId: null }].slice(-DISCUSSION_LIMITS.messages) }))) };
    });
  }

  // Deliver the latest final answer of `from` to the other side, with the person's comments.
  // Serialized per discussion so one answer can never be delivered twice; the cursor moves
  // only after the delivery was accepted, so a refused delivery can simply be retried.
  forward({ id, from, comment }) {
    return this.exclusive(id, async () => {
      const discussion = await this.store.get(id), to = otherRole(from);
      const answer = await this.participants[from].latestAnswer(this.conversationOf(discussion, from));
      const plan = planForward({ discussion, from, answer, comment });
      if (!plan.ok) throw httpError(plan.status, plan.reason);
      try { await this.participants[to].deliver(this.conversationOf(discussion, to), plan.text); }
      catch (error) { throw error.statusCode ? error : httpError(502, `无法转发给 ${ROLE_LABEL[to]}：${error.message}`); }
      const at = this.now().toISOString();
      const next = await this.store.update(id, discussion.revision, item => applyForward({ discussion: item, from, plan, answer, at,
        idFactory: this.idFactory, maxMessages: DISCUSSION_LIMITS.messages }));
      return { discussion: view(next), forwarded: { from, to, round: plan.round } };
    });
  }

  stop({ id }) {
    return this.exclusive(id, async () => {
      const current = await this.store.get(id);
      if (current.status === 'stopped') return { discussion: view(current) };
      return { discussion: view(await this.store.update(id, current.revision, item => ({ ...item, status: 'stopped', held: null,
        pendingComments: [], updatedAt: this.now().toISOString(), revision: item.revision + 1 }))) };
    });
  }
}

const normalizeDirectory = value => String(value || '').replace(/[\\/]+$/, '');
const view = discussion => structuredClone(discussion);
