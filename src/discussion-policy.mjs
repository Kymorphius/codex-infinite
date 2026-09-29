import { forwardEnvelope, otherRole } from './discussion-contract.mjs';

// Pure decision for one manual forward (phase 1): what, if anything, goes to the other side.
// `answer` is the latest final answer of `from` ({ turnId, text, at }) or null.
export function planForward({ discussion, from, answer, comment = '' }) {
  if (discussion.status === 'stopped') return { ok: false, status: 409, reason: '这个讨论已结束' };
  if (!answer?.text) return { ok: false, status: 409, reason: `${from === 'claude' ? 'Claude' : 'GPT'} 还没有可转发的回答` };
  if (discussion.cursors[from] === answer.turnId) return { ok: false, status: 409, reason: '这条回答已经转发过了' };
  const comments = [...discussion.pendingComments, ...(comment ? [comment] : [])];
  const round = discussion.round + 1, to = otherRole(from);
  const text = forwardEnvelope({ discussionId: discussion.id, from, round, answer: answer.text, comments });
  return { ok: true, to, round, text, comments, sourceTurnId: answer.turnId };
}

// Applying a delivered forward: advance the cursor, consume comments, extend the timeline.
export function applyForward({ discussion, from, plan, answer, at, idFactory, maxMessages }) {
  const messages = [...discussion.messages];
  if (!messages.some(item => item.sourceTurnId === answer.turnId && item.from === from && item.kind === 'answer')) {
    messages.push({ id: idFactory(), at: answer.at || at, kind: 'answer', from, to: plan.to, text: answer.text, sourceTurnId: answer.turnId });
  }
  for (const text of plan.comments) messages.push({ id: idFactory(), at, kind: 'comment', from: 'user', to: plan.to, text, sourceTurnId: answer.turnId });
  messages.push({ id: idFactory(), at, kind: 'forward', from, to: plan.to, text: plan.text, sourceTurnId: answer.turnId });
  return { ...discussion, round: plan.round, cursors: { ...discussion.cursors, [from]: answer.turnId },
    pendingComments: [], messages: messages.slice(-maxMessages), updatedAt: at, revision: discussion.revision + 1 };
}
