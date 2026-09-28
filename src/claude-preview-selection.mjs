// Dependency-free domain controller, also serialized into the native renderer.
export function isClaudePreviewModel(model) {
  if (model === 'claude-subscription/opus-cua-preview') return true;
  const match = /^claude-subscription\/(opus|sonnet|haiku|opusplan|default|best|opus-latest|sonnet-latest|haiku-latest|opusplan-latest|opus-1m|sonnet-1m)(-auto)?(-native)?$/.exec(model || '');
  return Boolean(match && (!['haiku', 'default', 'best', 'haiku-latest'].includes(match[1]) || !match[2]));
}

export function createClaudePreviewSelection({ read, apply, storage, changed = () => {} }) {
  const modelPrefix = 'claude-subscription/';
  const modelFamilies = ['opus', 'sonnet', 'haiku', 'opusplan', 'default', 'best', 'opus-latest', 'sonnet-latest', 'haiku-latest', 'opusplan-latest', 'opus-1m', 'sonnet-1m'];
  const autoOnly = new Set(['haiku', 'default', 'best', 'haiku-latest']);
  const key = 'codex-control-console.claude-preview.v1';
  const preferenceKey = 'codex-control-console.claude-preview-preference.v1';
  const validId = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '');
  const validModel = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(value);
  const efforts = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
  const records = new Map(), preferences = new Map(), pending = new Set();
  try {
    const saved = JSON.parse(storage.getItem(key) || '[]');
    for (const item of Array.isArray(saved) ? saved.slice(-128) : []) {
      if (validId(item?.id) && efforts.includes(item.effort) && modelFamilies.includes(item.modelFamily || 'opus')
        && validModel(item.original?.model) && /^[a-z]{1,16}$/.test(item.original?.reasoningEffort || ''))
        records.set(item.id, { ...item, modelFamily: item.modelFamily || 'opus' });
    }
  } catch {}
  try {
    const saved = JSON.parse(storage.getItem(preferenceKey) || '[]');
    for (const item of Array.isArray(saved) ? saved.slice(-128) : []) {
      if (validId(item?.id) && efforts.includes(item.effort) && typeof item.nativeTools === 'boolean'
        && modelFamilies.includes(item.modelFamily || 'opus'))
        preferences.set(item.id, { effort: item.effort, nativeTools: item.nativeTools, modelFamily: item.modelFamily || 'opus' });
    }
  } catch {}
  function persist() {
    storage.setItem(key, JSON.stringify([...records.values()]));
    try { storage.setItem(preferenceKey, JSON.stringify([...preferences].map(([id, value]) => ({ id, ...value })))); } catch { /* The active model still has its own durable record. */ }
    changed();
  }
  const matches = (actual, expected) => actual?.model === expected.model && actual?.reasoningEffort === expected.reasoningEffort;
  return {
    selected(id) { return records.get(id) || null; },
    preferred(id) { return preferences.get(id) || null; },
    blocks(id) { return pending.has(id) || records.has(id); },
    busy(id) { return pending.has(id); },
    async set(id, effort, nativeTools = true, modelFamily = 'opus') {
      if (typeof nativeTools !== 'boolean') throw new Error('Claude 工具模式无效');
      if (!validId(id) || (effort !== null && (!efforts.includes(effort) || !modelFamilies.includes(modelFamily)
        || (autoOnly.has(modelFamily) && effort !== 'auto')))) throw new Error('Claude 会话、模型或推理强度无效');
      if (pending.has(id)) throw new Error('正在修改这个会话，请稍候');
      if (effort !== null && !records.has(id) && records.size >= 128) throw new Error('Claude 预览会话数量已达上限，请先关闭旧会话的预览');
      const previous = records.get(id);
      const previousPreference = preferences.get(id);
      if (!previous && effort === null) return;
      pending.add(id); changed();
      let before, attempted = false;
      try {
        before = await read(id);
        if (!before?.model || !before.reasoningEffort) throw new Error('无法回读当前原生模型与强度');
        if (!previous && !validModel(before.model)) throw new Error('当前模型无法安全恢复，未启用预览');
        const original = previous?.original || { model: before.model, reasoningEffort: before.reasoningEffort };
        const next = effort === null ? original : { model: modelPrefix + modelFamily + (effort === 'auto' && !autoOnly.has(modelFamily) ? '-auto' : '') + (nativeTools ? '-native' : ''),
          reasoningEffort: effort === 'auto' ? 'medium' : effort };
        attempted = true;
        await apply(id, next);
        if (!matches(await read(id), next)) throw new Error('原生模型回读不一致');
        if (effort === null) records.delete(id);
        else {
          records.set(id, { id, effort, nativeTools, modelFamily, original });
          preferences.delete(id); preferences.set(id, { effort, nativeTools, modelFamily });
          if (preferences.size > 128) preferences.delete(preferences.keys().next().value);
        }
        persist();
      } catch (error) {
        if (previous) records.set(id, previous); else records.delete(id);
        if (previousPreference) preferences.set(id, previousPreference); else preferences.delete(id);
        if (attempted && before) {
          try {
            await apply(id, { model: before.model, reasoningEffort: before.reasoningEffort });
            if (!matches(await read(id), before)) throw new Error('恢复回读不一致');
          }
          catch { throw new Error('设置未确认，且恢复失败；请检查原生模型选择器'); }
        }
        throw error;
      } finally { pending.delete(id); changed(); }
    },
  };
}
