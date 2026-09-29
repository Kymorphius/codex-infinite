import { assertTerminalObject, terminalError } from './terminal-contract.mjs';

// Model / effort vocabulary of managed Claude terminal conversations. Mirrors the Router table
// (../jev-codex-router/src/claude-subscription-model.mjs: families, CLI IDs, auto-only) plus Fable.
// Self-contained: the page picker embeds this function's source.
export function claudeTerminalCatalog() {
  const row = (id, name, cliModel, lineage, extra = {}) => ({ id, name, cliModel, lineage, dynamic: false, autoOnly: false, ...extra });
  const alias = { dynamic: true };
  const models = [
    row('opus', 'Opus 5.5', 'claude-opus-5-5', ['opus']),
    row('sonnet', 'Sonnet 5.5', 'claude-sonnet-5-5', ['sonnet']),
    row('haiku', 'Haiku 4.5', 'claude-haiku-4-5-20251001', ['haiku'], { autoOnly: true }),
    row('fable', 'Fable 5.1', 'claude-fable-5-1', ['fable']),
    row('opusplan', 'Opus 5.5 规划 / Sonnet 5.5 执行', 'opusplan', ['opus', 'sonnet']),
    row('default', '默认（随账号变化）', 'default', ['*'], { ...alias, autoOnly: true }),
    row('best', 'best（可能使用额外 usage credits）', 'best', ['*'], { ...alias, autoOnly: true }),
    row('opus-latest', 'Opus 最新（随 Claude 更新）', 'opus', ['opus'], alias),
    row('sonnet-latest', 'Sonnet 最新（随 Claude 更新）', 'sonnet', ['sonnet'], alias),
    row('haiku-latest', 'Haiku 最新（随 Claude 更新）', 'haiku', ['haiku'], { ...alias, autoOnly: true }),
    row('opusplan-latest', 'Opus 规划 / Sonnet 执行（随 Claude 更新）', 'opusplan', ['opus', 'sonnet'], alias),
    row('opus-1m', 'Opus 最新 · 1M（需账号支持）', 'opus[1m]', ['opus'], alias),
    row('sonnet-1m', 'Sonnet 最新 · 1M（需账号支持）', 'sonnet[1m]', ['sonnet'], alias),
  ];
  const efforts = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
  const effortLabels = { auto: '自动', low: '轻度', medium: '中', high: '高', xhigh: '极高', max: '最高' };
  return { models, efforts, effortLabels };
}

const CATALOG = claudeTerminalCatalog();
const MODELS = new Map(CATALOG.models.map(model => [model.id, model]));
export const CLAUDE_TERMINAL_EFFORTS = Object.freeze([...CATALOG.efforts]);
// Characters a CLI model ID may use; anything else never reaches a shell command.
export const CLAUDE_CLI_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.\-[\]]{0,79}$/u;

export const claudeTerminalModel = id => MODELS.get(id) || null;

// Picker input: { model, effort, ultracode }. model null keeps Claude's own default (no --model,
// no /model). Auto-only models take no fixed effort.
export function claudeTerminalSettingsInput(input) {
  assertTerminalObject(input, ['model', 'effort', 'ultracode']);
  const model = input.model === null ? null : claudeTerminalModel(input.model);
  if (input.model !== null && !model) throw terminalError(400, 'Claude 模型无效');
  if (!CLAUDE_TERMINAL_EFFORTS.includes(input.effort)) throw terminalError(400, 'Claude 推理强度无效');
  if (model?.autoOnly && input.effort !== 'auto') throw terminalError(400, '这个 Claude 模型只能使用自动推理强度');
  if (typeof input.ultracode !== 'boolean') throw terminalError(400, 'Ultracode 标记无效');
  return { model: model?.id ?? null, effort: input.effort, ultracode: input.ultracode };
}

// Persisted form (picker input plus when it was chosen or observed in Claude), read leniently so a
// later catalog change never makes the registry unreadable: a malformed value or a model no longer
// in the catalog drops the choice, and an effort the model no longer allows becomes auto.
export function claudeTerminalSettingsStored(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { model, effort, ultracode, updatedAt } = input, row = model === null ? null : claudeTerminalModel(model);
  if ((model !== null && !row) || typeof ultracode !== 'boolean' || typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) return null;
  return { model: row?.id ?? null, effort: CLAUDE_TERMINAL_EFFORTS.includes(effort) && !row?.autoOnly ? effort : 'auto', ultracode, updatedAt };
}

// Launch flags: --model unless unset, --effort unless auto (as Router's claudeModelArgs).
export function claudeLaunchArgs(settings) {
  if (!settings) return [];
  const { model, effort } = claudeTerminalSettingsInput({ model: settings.model ?? null, effort: settings.effort, ultracode: false });
  const cliModel = model && MODELS.get(model).cliModel;
  if (cliModel && !CLAUDE_CLI_MODEL_PATTERN.test(cliModel)) throw terminalError(400, 'Claude 模型无效');
  return [...(cliModel ? ['--model', cliModel] : []), ...(effort === 'auto' ? [] : ['--effort', effort])];
}

// opusplan pins both versions so the alias cannot drift from the picker's label (Router does the same).
export function claudeLaunchEnvironment(settings) {
  return settings?.model === 'opusplan' ? { ANTHROPIC_DEFAULT_OPUS_MODEL: MODELS.get('opus').cliModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: MODELS.get('sonnet').cliModel } : {};
}

// Slash commands that take a running Claude from `current` (null: unknown, ultracode off) to
// `target`. Each step carries the settings reached once it has been typed. An unset target model
// types nothing (there is no /model for "Claude's default"). A new effort level may end ultracode,
// so with ultracode wanted it is sent again afterwards.
export function claudeSettingsCommands(current, target) {
  const steps = [];
  let reached = current ? { model: current.model, effort: current.effort, ultracode: current.ultracode === true } : { model: null, effort: null, ultracode: false };
  const step = (text, change) => { reached = { ...reached, ...change }; steps.push({ text, settings: reached }); };
  if (target.model !== null && reached.model !== target.model) step(`/model ${MODELS.get(target.model).cliModel}`, { model: target.model });
  if (reached.effort !== target.effort) step(`/effort ${target.effort}`, { effort: target.effort, ...(target.ultracode ? { ultracode: false } : {}) });
  if (reached.ultracode !== target.ultracode) step(target.ultracode ? '/effort ultracode' : '/effort ultracode off', { ultracode: target.ultracode });
  return steps;
}

const lineageOf = value => /^claude-(opus|sonnet|haiku|fable)-/u.exec(value)?.[1] || null;
const exactModel = lower => (CATALOG.models.find(model => model.cliModel.toLowerCase() === lower) || MODELS.get(lower))?.id || null;

// Maps a /model argument the person typed in Claude to a catalog ID: exactly (current choice first,
// so `/model opus` keeps opus-latest rather than another row with the same CLI ID), else null.
export function claudeModelFromCommand(value, currentId = null) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const lower = value.trim().toLowerCase(), current = MODELS.get(currentId) || null;
  return current && current.cliModel.toLowerCase() === lower ? current.id : exactModel(lower);
}

// Maps a resolved assistant model ID (claude-opus-5-5) to a catalog ID. An alias or opusplan choice
// that can explain it wins, so opus-latest is never replaced by the ID it resolved to; a fixed
// version only explains its own ID. Unknown models map to null.
export function claudeModelFromReply(value, currentId = null) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const lower = value.trim().toLowerCase(), current = MODELS.get(currentId) || null, lineage = lineageOf(lower);
  if (current && current.cliModel.toLowerCase() === lower) return current.id;
  if (current && lineage && !current.cliModel.startsWith('claude-') && (current.lineage.includes(lineage) || current.lineage.includes('*'))) return current.id;
  return exactModel(lower);
}
