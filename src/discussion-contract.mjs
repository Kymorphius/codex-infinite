import { httpError } from './http-utils.mjs';

export const DISCUSSION_LIMITS = { discussions: 200, messages: 200, textChars: 12_000, commentChars: 4_000, topicChars: 8_000 };
export const DISCUSSION_ROLES = ['claude', 'gpt'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const LABEL = { claude: 'Claude', gpt: 'GPT' };

export const otherRole = role => role === 'claude' ? 'gpt' : 'claude';

export function discussionId(value) {
  if (typeof value !== 'string' || !ID.test(value)) throw httpError(400, '讨论标识无效');
  return value.toLowerCase();
}

export function discussionRole(value) {
  if (!DISCUSSION_ROLES.includes(value)) throw httpError(400, '讨论参与方无效');
  return value;
}

export function cleanText(value, max, label) {
  if (value == null) return '';
  if (typeof value !== 'string') throw httpError(400, `${label}无效`);
  const text = value.replace(CONTROL, '').trim();
  if (text.length > max) throw httpError(413, `${label}过长`);
  return text;
}

function exact(input, keys) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, '请求内容无效');
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw httpError(400, '请求包含未知字段');
}

export function discussionCreateInput(input) {
  exact(input, ['claudeConversationId', 'gptConversationId']);
  return { claudeConversationId: discussionId(input.claudeConversationId), gptConversationId: discussionId(input.gptConversationId) };
}

export function discussionForwardInput(input) {
  exact(input, ['id', 'from', 'comment']);
  return { id: discussionId(input.id), from: discussionRole(input.from),
    comment: cleanText(input.comment, DISCUSSION_LIMITS.commentChars, '点评') };
}

export function discussionCommentInput(input) {
  exact(input, ['id', 'text']);
  const text = cleanText(input.text, DISCUSSION_LIMITS.commentChars, '点评');
  if (!text) throw httpError(400, '点评不能为空');
  return { id: discussionId(input.id), text };
}

// The receiver, and the person reading either conversation, can tell forwarded text from
// typing. The answer comes first; the person's comments follow under their own heading.
export function forwardEnvelope({ discussionId: id, from, round, answer, comments }) {
  const head = `[来自 ${LABEL[from]} · 讨论 ${id.slice(0, 8)} · 第 ${round} 轮]`;
  const body = comments.length ? `${answer}\n\n[主持人点评]\n${comments.join('\n\n')}` : answer;
  const text = `${head}\n${body}`;
  if (text.length > DISCUSSION_LIMITS.textChars) throw httpError(413, '转发内容过长，请缩短点评');
  return text;
}

export function discussionPrepareInput(input) {
  exact(input, ['first', 'topic']);
  const topic = cleanText(input.topic, DISCUSSION_LIMITS.topicChars, '议题');
  if (!topic) throw httpError(400, '请先写下议题');
  return { first: discussionRole(input.first), topic };
}

export function discussionBeginInput(input) {
  exact(input, ['first', 'topic', 'claudeConversationId', 'gptConversationId', 'sendGpt']);
  if (input.sendGpt !== undefined && typeof input.sendGpt !== 'boolean') throw httpError(400, '开场消息标记无效');
  // sendGpt: the GPT side is an existing conversation (not created with its message), so the host sends it.
  return { sendGpt: input.sendGpt === true, ...discussionPrepareInput({ first: input.first, topic: input.topic }),
    ...discussionCreateInput({ claudeConversationId: input.claudeConversationId, gptConversationId: input.gptConversationId }) };
}

// What each side receives when a discussion starts. The first responder gets the topic as
// typed. The other side cannot stay empty (a native GPT conversation only exists once its
// first message is sent), so it is told the topic and to wait for the forwarded answer.
export function discussionOpeningTexts({ first, topic }) {
  const second = otherRole(first);
  const primer = `[协作讨论 · 议题]\n${topic}\n\n这是你和 ${LABEL[first]} 的协作讨论，${LABEL[first]} 先回答。你现在先不要作答，只回复"收到"。等收到标有"[来自 ${LABEL[first]} …]"的转发消息后，再给出你的看法。`;
  return { first, second, texts: { [first]: topic, [second]: primer } };
}
