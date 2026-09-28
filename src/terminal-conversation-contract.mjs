import { assertTerminalObject, terminalError } from './terminal-contract.mjs';

export const TERMINAL_CONVERSATION_LIMIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function terminalConversationId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw terminalError(400, '终端会话标识无效');
  return value.toLowerCase();
}

// start accepts an explicit takeover flag; anything but a literal boolean is rejected.
export function terminalStartInput(input) {
  assertTerminalObject(input, ['id', 'takeover']);
  if (input.takeover !== undefined && typeof input.takeover !== 'boolean') throw terminalError(400, '接管标记无效');
  return { id: terminalConversationId(input.id), takeover: input.takeover === true };
}

// Create (or open) the Router companion Claude session of a native Codex thread.
export function terminalCompanionCreateInput(input) {
  assertTerminalObject(input, ['threadId']);
  return { threadId: terminalConversationId(input.threadId) };
}

export function terminalConversationText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw terminalError(400, `${label}无效`);
  }
  return value.trim();
}

export function terminalProjectReference(value) {
  if (value === null) return null;
  assertTerminalObject(value, ['source', 'key', 'id', 'hostId']);
  if (!['codex', 'chatgpt'].includes(value.source)) throw terminalError(400, '项目来源无效');
  return { source: value.source, key: terminalConversationText(value.key, '项目标识', 500),
    id: terminalConversationText(value.id, '项目标识', 500), hostId: terminalConversationText(value.hostId, '项目主机', 160) };
}

export function terminalConversationCreate(input) {
  assertTerminalObject(input, ['cwd', 'kind', 'title', 'projectRef']);
  const cwd = terminalConversationText(input.cwd, '工作目录', 4096), kind = input.kind ?? 'shell';
  if (!['shell', 'claude'].includes(kind)) throw terminalError(400, '终端类型无效');
  return { cwd, kind, title: own(input, 'title') ? terminalConversationText(input.title, '会话标题')
    : kind === 'claude' ? 'Claude CLI' : '终端', projectRef: terminalProjectReference(input.projectRef ?? null) };
}

export function terminalConversationUpdate(input) {
  assertTerminalObject(input, ['id', 'expectedRevision', 'title', 'pinned', 'archived', 'projectRef']);
  const id = terminalConversationId(input.id), expectedRevision = input.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw terminalError(400, '会话版本无效');
  const changes = {};
  if (own(input, 'title')) changes.title = terminalConversationText(input.title, '会话标题');
  for (const key of ['pinned', 'archived']) if (own(input, key)) {
    if (typeof input[key] !== 'boolean') throw terminalError(400, '会话状态无效');
    changes[key] = input[key];
  }
  if (own(input, 'projectRef')) changes.projectRef = terminalProjectReference(input.projectRef);
  if (!Object.keys(changes).length) throw terminalError(400, '没有会话变更');
  return { id, expectedRevision, changes };
}

export function terminalConversationRecord(input, deviceId) {
  assertTerminalObject(input, ['id', 'provider', 'deviceId', 'cwd', 'kind', 'title', 'projectRef',
    'pinned', 'archived', 'createdAt', 'updatedAt', 'revision', 'companionOf']);
  const normalized = terminalConversationCreate({ cwd: input.cwd, kind: input.kind, title: input.title, projectRef: input.projectRef });
  if (input.provider !== 'terminal' || input.deviceId !== deviceId || !Number.isSafeInteger(input.revision)
      || input.revision < 1 || typeof input.pinned !== 'boolean' || typeof input.archived !== 'boolean'
      || ![input.createdAt, input.updatedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) {
    throw terminalError(400, '终端会话记录无效');
  }
  // companionOf: the Codex thread whose Router-owned Claude session this record resumes.
  // Only adoption sets it; create/update inputs never accept it.
  const companionOf = input.companionOf === undefined ? undefined : terminalConversationId(input.companionOf);
  if (companionOf && normalized.kind !== 'claude') throw terminalError(400, '伴生会话必须是 Claude 会话');
  return { id: terminalConversationId(input.id), provider: 'terminal', deviceId, ...normalized,
    pinned: input.pinned, archived: input.archived, createdAt: input.createdAt, updatedAt: input.updatedAt, revision: input.revision,
    ...(companionOf ? { companionOf } : {}) };
}
