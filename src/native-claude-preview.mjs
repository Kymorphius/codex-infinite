import { createClaudePreviewSelection } from './claude-preview-selection.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { installNativeJevButtonActivation } from './native-jev-button-activation.mjs';

export function buildNativeClaudePreviewInjectionScript() {
  return buildNativeClaudePanelStyleScript() + `;(${installClaudePreview.toString()})(${createClaudePreviewSelection.toString()}, ${readNativeComposerThreadId.toString()}, ${installNativeJevButtonActivation.toString()})`;
}

export function buildNativeClaudePanelStyleScript() {
  return `(() => {
    let style = document.getElementById('ccc-claude-panel-style');
    if (!style) { style = document.createElement('style'); style.id = 'ccc-claude-panel-style'; document.head.append(style); }
    const css = ${JSON.stringify(`
      [data-ccc-claude-preview-panel] { box-sizing:border-box; color-scheme:dark; }
      [data-ccc-claude-preview-panel] > strong { display:inline-block; font-size:16px; line-height:32px; }
      [data-ccc-claude-preview-panel] p { margin:12px 0; }
      [data-ccc-claude-preview-panel] label { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:16px 0 8px; }
      [data-ccc-claude-preview-panel] select { appearance:auto; min-width:116px; max-width:210px; min-height:36px; padding:6px 12px; border:1px solid #626262; border-radius:8px; background:#303030; color:#eee; font:inherit; cursor:pointer; }
      [data-ccc-claude-preview-panel] input[type=checkbox] { appearance:auto; width:18px; height:18px; flex:none; accent-color:#62bd84; }
      [data-ccc-claude-preview-panel] button { display:inline-flex; align-items:center; justify-content:center; min-height:36px; padding:7px 12px; margin:4px 8px 4px 0; border:1px solid #626262; border-radius:8px; background:#303030; color:#eee; font:inherit; cursor:pointer; }
      [data-ccc-claude-preview-panel] button:hover:not(:disabled) { background:#3a3a3a; }
      [data-ccc-claude-preview-panel] button:disabled, [data-ccc-claude-preview-panel] select:disabled, [data-ccc-claude-preview-panel] input:disabled { opacity:.45; cursor:default; }
      [data-ccc-claude-preview-panel] :is(button,select,input):focus-visible { outline:2px solid #62bd84; outline-offset:2px; }
      [data-ccc-claude-preview-panel] [data-claude-actions] { display:flex; flex-wrap:wrap; gap:8px; margin-top:16px; }
      [data-ccc-claude-preview-panel] [data-claude-actions] button { margin:0; flex:1 1 auto; }
      [data-ccc-claude-preview-panel] [data-claude-primary] { border-color:#508d65; background:#294b35; color:#a6e5ba; }
    `)};
    if (style.textContent !== css) style.textContent = css;
  })()`;
}

function installClaudePreview(createSelection, readThreadId, activateButton) {
  const version = 3;
  if (window.__cccClaudePreviewInstalled && window.__cccClaudePreviewVersion === version && window.__cccClaudePreviewRefresh) {
    window.__cccClaudePreviewRefresh(); return;
  }
  if (window.__cccClaudePreviewInstalled) {
    if (typeof window.__cccClaudePreviewDispose === 'function') window.__cccClaudePreviewDispose();
    else {
      window.__codexControlConsoleMutationSubscribers?.delete(window.__cccClaudePreviewRefresh);
      document.querySelector('[data-ccc-claude-preview-panel]')?.remove();
    }
  }
  document.querySelector('[data-ccc-claude-preview]')?.remove();
  window.__cccClaudePreviewInstalled = true;
  window.__cccClaudePreviewVersion = version;
  let timer, panel, button;
  const selection = createSelection({
    storage: localStorage,
    async read(id) {
      if (typeof window.__codexControlConsoleReadThreadSettings !== 'function') throw new Error('原生会话设置接口尚未就绪');
      return window.__codexControlConsoleReadThreadSettings(id);
    },
    async apply(id, settings) {
      const result = await window.__codexControlConsoleApplyThreadSettings?.(id, settings);
      if (!result?.applied) throw new Error('原生会话没有确认设置');
    },
    changed: () => schedule(),
  });
  window.__cccClaudePreviewBlocks = id => selection.blocks(id);
  const running = () => Boolean(document.querySelector('button[aria-label="停止"],button[aria-label="Stop"],button[aria-label="停止流式传输"],button[aria-label="Stop streaming"]'));
  const routerReady = () => window.__cccClaudeRouterReady?.() === true;
  function current() {
    if (window.__cccNativeTerminalView) return null;
    const selected = document.querySelector('[data-app-action-sidebar-thread-id][aria-current="page"],[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-selected="true"]')?.getAttribute('data-app-action-sidebar-thread-id') || '';
    if (selected && !selected.startsWith('local:') && !/^[0-9a-f-]{36}$/i.test(selected)) return null;
    return readThreadId(document);
  }
  function element(tag, text) { const node = document.createElement(tag); if (text) node.textContent = text; return node; }
  function close() { panel?.remove(); panel = null; document.removeEventListener('pointerdown', outside, true); }
  function outside(event) { if (panel && !event.composedPath().includes(panel) && !event.composedPath().includes(button)) close(); }
  const modelNames = { opus: 'Opus 5.5', sonnet: 'Sonnet 5.5', haiku: 'Haiku 4.5', opusplan: 'Opus 5.5 规划 / Sonnet 5.5 执行',
    default: '默认（随账号变化）', best: 'best（可能使用额外 usage credits）',
    'opus-latest': 'Opus 最新（随 Claude 更新）', 'sonnet-latest': 'Sonnet 最新（随 Claude 更新）',
    'haiku-latest': 'Haiku 最新（随 Claude 更新）', 'opusplan-latest': 'Opus 规划 / Sonnet 执行（随 Claude 更新）',
    'opus-1m': 'Opus 最新 · 1M（需账号支持）', 'sonnet-1m': 'Sonnet 最新 · 1M（需账号支持）' };
  const autoOnly = new Set(['haiku', 'default', 'best', 'haiku-latest']);
  const buttonNames = { opusplan: 'Claude OpusPlan 5.5', default: 'Claude 默认', best: 'Claude best',
    'opus-latest': 'Claude Opus 最新', 'sonnet-latest': 'Claude Sonnet 最新', 'haiku-latest': 'Claude Haiku 最新',
    'opusplan-latest': 'Claude OpusPlan 最新', 'opus-1m': 'Claude Opus 1M', 'sonnet-1m': 'Claude Sonnet 1M' };
  const effortNames = { auto: '自动', low: '轻度', medium: '中', high: '高', xhigh: '超高', max: '最高', ultracode: 'Ultracode（多智能体）' };
  async function toggle() {
    const id = current();
    if (!id || running() || selection.busy(id)) return;
    const selected = selection.selected(id);
    if (!selected && !routerReady()) return;
    close();
    const preference = selection.preferred(id) || { effort: 'auto', nativeTools: true, modelFamily: 'opus' };
    try { await selection.set(id, selected ? null : preference.effort, preference.nativeTools, preference.modelFamily); window.__cccClaudePreviewError = ''; }
    catch (error) { window.__cccClaudePreviewError = String(error.message || '切换失败'); open(); }
    schedule();
  }
  function open() {
    close();
    const id = current(), selected = selection.selected(id), preference = selected || selection.preferred(id);
    panel = element('section'); panel.dataset.cccClaudePreviewPanel = ''; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Claude 设置');
    panel.style.cssText = 'position:fixed;z-index:2147483000;width:min(300px,calc(100vw - 24px));padding:14px;border:1px solid #4b765a;border-radius:14px;background:#252525;color:#eee;box-shadow:0 12px 40px #0008;font:14px/1.5 system-ui;max-height:calc(100vh - 24px);overflow:auto;';
    const rect = button.getBoundingClientRect(), width = Math.min(300, window.innerWidth - 24);
    panel.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)) + 'px';
    panel.style.bottom = Math.max(12, window.innerHeight - rect.top + 8) + 'px';
    const title = element('strong', 'Claude 设置');
    const dismiss = element('button', '关闭'); dismiss.type = 'button'; dismiss.style.cssText = 'float:right;'; dismiss.onclick = close;
    const modelLabel = element('label', '模型 '), model = element('select'); model.setAttribute('aria-label', 'Claude 模型');
    for (const [value, text] of Object.entries(modelNames)) { const option = element('option', text); option.value = value; model.append(option); }
    model.value = preference?.modelFamily || 'opus'; modelLabel.append(model);
    const label = element('label', '推理强度 '), effort = element('select'); effort.setAttribute('aria-label', 'Claude 推理强度');
    for (const [value, text] of Object.entries(effortNames)) { const option = element('option', text); option.value = value; effort.append(option); }
    effort.value = preference?.effort || 'auto'; label.append(effort);
    model.onchange = () => { if (autoOnly.has(model.value)) effort.value = 'auto'; effort.disabled = disabled || autoOnly.has(model.value); };
    const toolsLabel = element('label', ' Claude 原生工具'), nativeTools = element('input');
    nativeTools.type = 'checkbox'; nativeTools.setAttribute('role', 'switch'); nativeTools.setAttribute('aria-label', 'Claude 原生工具');
    nativeTools.checked = preference?.nativeTools ?? true; toolsLabel.prepend(nativeTools);
    toolsLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;'; nativeTools.style.accentColor = '#62bd84';
    const message = element('p', window.__cccClaudePreviewError || (!id ? '请先打开本机会话' : '')); message.setAttribute('role', 'status');
    const save = element('button', '应用'), restore = element('button', '切回 GPT');
    const actions = element('div'); actions.dataset.claudeActions = ''; save.dataset.claudePrimary = ''; actions.append(save, restore);
    save.type = restore.type = 'button';
    const disabled = !id || running() || selection.busy(id);
    save.disabled = disabled; restore.disabled = disabled || !selected;
    if (!routerReady()) { save.disabled = true; message.textContent = 'Router 未就绪'; }
    if (running()) message.textContent = '生成中，请稍后切换';
    async function change(value) {
      if (value !== null && !routerReady()) { message.textContent = 'Router 通道尚未就绪，未修改模型。'; return; }
      if (id !== current() || running()) { message.textContent = '会话已切换或正在生成，请重新打开设置。'; return; }
      const useNativeTools = nativeTools.checked;
      save.disabled = restore.disabled = nativeTools.disabled = effort.disabled = model.disabled = true;
      try {
        const family = model.value;
        await selection.set(id, value === null ? null : autoOnly.has(family) ? 'auto' : value, useNativeTools, family);
        window.__cccClaudePreviewError = ''; message.textContent = value === null ? '已切回 GPT' : '已设为 Claude ' + modelNames[family];
      } catch (error) { message.textContent = String(error.message || '设置失败'); }
      finally { const blocked = id !== current() || running(); nativeTools.disabled = model.disabled = blocked; effort.disabled = blocked || autoOnly.has(model.value); save.disabled = blocked || !routerReady(); restore.disabled = blocked || !selection.selected(id); }
    }
    save.onclick = () => void change(effort.value); restore.onclick = () => void change(null);
    nativeTools.disabled = model.disabled = disabled; effort.disabled = disabled || autoOnly.has(model.value);
    panel.append(title, dismiss, modelLabel, label, toolsLabel, message, actions); document.body.append(panel);
    if (panel.getBoundingClientRect().top < 12) { panel.style.bottom = 'auto'; panel.style.top = Math.max(12, Math.min(window.innerHeight - panel.offsetHeight - 12, rect.bottom + 8)) + 'px'; }
    document.addEventListener('pointerdown', outside, true);
  }
  function render() {
    for (const stale of document.querySelectorAll('[data-ccc-claude-preview]')) if (stale !== button) stale.remove();
    const routing = document.querySelector('[data-codex-control-console-native-jev-current]');
    const host = routing?.parentElement;
    if (!host) { button?.remove(); return; }
    if (!button) {
      button = element('button'); button.type = 'button'; button.dataset.cccClaudePreview = ''; button.setAttribute('aria-label', '切换 GPT 与 Claude；右键打开设置');
      button.style.cssText = 'height:28px;flex:none;padding:0 10px;border:1px solid #ffffff24;border-radius:999px;background:transparent;color:inherit;font:600 12px system-ui;white-space:nowrap;cursor:pointer;';
      activateButton(button, toggle);
      button.addEventListener('contextmenu', event => { event.preventDefault(); event.stopImmediatePropagation(); open(); });
    }
    const id = current(), selected = selection.selected(id), family = selected?.modelFamily || 'opus';
    const text = selected ? buttonNames[family] || 'Claude ' + modelNames[family] : 'GPT';
    if (button.textContent !== text) button.textContent = text;
    const pressed = String(Boolean(selected));
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    button.style.color = selected ? '#e9a58d' : '';
    button.style.borderColor = selected ? '#d97757' : '';
    button.style.background = selected ? 'rgba(217,119,87,.16)' : '';
    // Written only on change: another module observing this button must not be woken every refresh.
    const title = window.__cccClaudePreviewError || (selected ? 'Claude · 左键切回 GPT，右键设置' : 'GPT · 左键切换 Claude，右键设置');
    if (button.title !== title) button.title = title;
    if (button.parentElement !== host) routing.after(button);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 60); }
  window.__cccClaudePreviewRefresh = schedule;
  (window.__codexControlConsoleMutationSubscribers ||= new Set()).add(schedule);
  const onPopstate = () => { close(); schedule(); };
  const onKeydown = event => { if (event.key === 'Escape') close(); };
  window.addEventListener('popstate', onPopstate);
  document.addEventListener('keydown', onKeydown);
  window.__cccClaudePreviewDispose = () => {
    clearTimeout(timer); close(); button?.remove();
    window.__codexControlConsoleMutationSubscribers?.delete(schedule);
    window.removeEventListener?.('popstate', onPopstate);
    document.removeEventListener('keydown', onKeydown);
  };
  render();
}
