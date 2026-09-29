import { CLAUDE_TERMINAL_EFFORTS, claudeModelFromCommand, claudeModelFromReply, claudeTerminalModel } from './claude-terminal-settings.mjs';

// Model / effort evidence in a Claude transcript: the last main-thread assistant reply (resolved
// message.model and effort) and the last /model and /effort local commands with their arguments.
const KEYS = ['assistant', 'modelCommand', 'effortCommand', 'ultracode'];
const COMMAND = /<command-name>\/(model|effort)<\/command-name>/u, ARGS = /<command-args>([^<]*)<\/command-args>/u;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const body = content => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : '';

// Records evidence from one transcript record of the session; later records overwrite earlier ones.
export function observeClaudeSettings(record, observed = {}) {
  const at = time(record?.timestamp);
  if (!at || record.isSidechain) return observed;
  if (record.type === 'assistant') {
    const model = record.message?.model;
    if (typeof model === 'string' && /^claude-[a-z0-9.\-[\]]{1,80}$/iu.test(model)) {
      observed.assistant = { model, effort: CLAUDE_TERMINAL_EFFORTS.includes(record.effort) ? record.effort : null, at };
    }
    return observed;
  }
  if (record.type !== 'user') return observed;
  const text = body(record.message?.content), command = COMMAND.exec(text)?.[1];
  const args = command ? (ARGS.exec(text)?.[1] || '').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
  if (!args || args.length > 80) return observed;
  if (command === 'model') observed.modelCommand = { value: args, at };
  else if (/^ultracode( on)?$/u.test(args)) observed.ultracode = { value: true, at };
  else if (args === 'ultracode off') observed.ultracode = { value: false, at };
  else if (CLAUDE_TERMINAL_EFFORTS.includes(args)) observed.effortCommand = { value: args, at };
  return observed;
}

// Whether every kind of evidence has been found (a backwards scan can stop).
export const claudeSettingsComplete = observed => KEYS.every(key => observed?.[key]);

// Newest evidence per kind across the files of one continuation chain.
export function mergeClaudeSettingsObservations(list) {
  const merged = {};
  for (const observed of list) for (const key of KEYS) {
    if (observed?.[key] && !(merged[key] && merged[key].at >= observed[key].at)) merged[key] = observed[key];
  }
  return merged;
}

// Applies evidence newer than `since` in time order. A /model argument maps exactly; a resolved
// assistant model never replaces a choice that explains it (claudeModelFromReply), nor an unset
// model (Claude's own default explains any reply) unless `learn` (describing what Claude used). The
// resolved effort is ignored while the choice is auto (auto resolves to the model's default level).
// A plain /effort level ends ultracode, as the applier assumes (claudeSettingsCommands).
function fold(start, observed, since, learn = false) {
  const after = Number.isFinite(Date.parse(since)) ? Date.parse(since) : -Infinity;
  const events = KEYS.filter(key => observed?.[key] && Date.parse(observed[key].at) > after)
    .map(key => ({ key, ...observed[key] })).sort((a, b) => a.at.localeCompare(b.at));
  let { model, effort, ultracode } = start;
  for (const event of events) {
    if (event.key === 'modelCommand') model = claudeModelFromCommand(event.value, model) || model;
    if (event.key === 'assistant' && (model || learn)) model = claudeModelFromReply(event.model, model) || model;
    if (event.key === 'effortCommand') { effort = event.value; if (ultracode !== null) ultracode = false; }
    if (event.key === 'assistant' && event.effort && effort !== 'auto') effort = event.effort;
    if (event.key === 'ultracode') ultracode = event.value;
  }
  if (claudeTerminalModel(model)?.autoOnly) effort = 'auto';
  return { model, effort, ultracode, last: events.at(-1)?.at || null };
}

// Settings to write back after the person changed them inside Claude, or null. Only evidence newer
// than the stored choice counts, so a fresh picker choice is never reverted by older replies.
export function adoptClaudeSettings(current, observed) {
  if (!current) return null;
  const next = fold(current, observed, current.updatedAt);
  if (!next.last || (next.model === current.model && next.effort === current.effort && next.ultracode === current.ultracode)) return null;
  return { model: next.model, effort: next.effort, ultracode: next.ultracode, updatedAt: next.last };
}

// What Claude last used, for display when no choice is stored (unknown parts stay null).
export function observedClaudeSettings(observed) {
  const next = fold({ model: null, effort: null, ultracode: null }, observed, null, true);
  return next.last && (next.model || next.effort || next.ultracode !== null) ? { model: next.model, effort: next.effort, ultracode: next.ultracode } : null;
}
