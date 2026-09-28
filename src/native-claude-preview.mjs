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
      [data-ccc-claude-preview-panel] select { appearance:auto; min-width:116px; min-height:36px; padding:6px 12px; border:1px solid #626262; border-radius:8px; background:#303030; color:#eee; font:inherit; cursor:pointer; }
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
  if (window.__cccClaudePreviewInstalled && window.__cccClaudePreviewRefresh) { window.__cccClaudePreviewRefresh(); return; }
  document.querySelector('[data-ccc-claude-preview]')?.remove();
  window.__cccClaudePreviewInstalled = true;
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
  function close() { panel?.remove(); panel = null; }
  function open() {
    close();
    const id = current(), selected = selection.selected(id);
    panel = element('section'); panel.dataset.cccClaudePreviewPanel = ''; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Claude 预览设置');
    panel.style.cssText = 'position:fixed;z-index:2147483000;right:24px;bottom:100px;width:min(360px,calc(100vw - 48px));padding:20px;border:1px solid #4b765a;border-radius:16px;background:#252525;color:#eee;box-shadow:0 12px 40px #0008;font:14px/1.5 system-ui;';
    const title = element('strong', 'Claude 预览');
    const dismiss = element('button', '关闭'); dismiss.type = 'button'; dismiss.style.cssText = 'float:right;'; dismiss.onclick = close;
    panel.style.maxHeight = 'calc(100vh - 140px)'; panel.style.overflowY = 'auto';
    const description = element('p', '当前会话使用 Claude 订阅。默认使用客户端工具；可开启下方原生工具模式。支持图片与工具历史，较早内容按需回查。');
    const model = element('p', '模型：Claude Opus');
    const label = element('label', '推理强度 '), effort = element('select'); effort.setAttribute('aria-label', 'Claude 推理强度');
    for (const [value, text] of [['low', '轻度'], ['medium', '中'], ['high', '高'], ['xhigh', '超高'], ['max', '最高']]) { const option = element('option', text); option.value = value; effort.append(option); }
    effort.value = selected?.effort || 'medium'; label.append(effort);
    const toolsLabel = element('label', ' Claude 原生工具'), nativeTools = element('input');
    nativeTools.type = 'checkbox'; nativeTools.setAttribute('role', 'switch'); nativeTools.setAttribute('aria-label', 'Claude 原生工具');
    nativeTools.checked = selected?.nativeTools === true; toolsLabel.prepend(nativeTools);
    toolsLabel.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:14px;'; nativeTools.style.accentColor = '#62bd84';
    const toolsHelp = element('p', '开启：使用 Claude 完整内置工具与技能，由 CLI 自动判断权限；需人工批准的操作会拒绝。Computer Use 仍走客户端。不会加载额外 MCP 或 hooks。关闭：工具全部由客户端执行。');
    toolsHelp.style.cssText = 'font-size:12px;color:#bbb;';
    const message = element('p', id ? '只修改当前会话；不改变全局模型和访问权限。' : '请先打开一个本机 Codex 会话。新建聊天尚未生成会话 ID 时不可切换。'); message.setAttribute('role', 'status');
    const save = element('button', '当前会话使用 Claude'), restore = element('button', '恢复原生模型');
    const actions = element('div'); actions.dataset.claudeActions = ''; save.dataset.claudePrimary = ''; actions.append(save, restore);
    save.type = restore.type = 'button';
    const disabled = !id || running() || selection.busy(id);
    save.disabled = disabled; restore.disabled = disabled || !selected;
    if (!routerReady()) { save.disabled = true; message.textContent = '请先在路由设置中启用 Router 通道；原生直连不能使用 Claude 预览。'; }
    if (running()) message.textContent = '当前会话正在生成，请结束后再切换。';
    async function change(value) {
      if (value !== null && !routerReady()) { message.textContent = 'Router 通道尚未就绪，未修改模型。'; return; }
      if (id !== current() || running()) { message.textContent = '会话已切换或正在生成，请重新打开设置。'; return; }
      const useNativeTools = nativeTools.checked;
      save.disabled = restore.disabled = nativeTools.disabled = effort.disabled = true;
      try {
        await selection.set(id, value, useNativeTools);
        message.textContent = value === null ? '已回读确认：恢复原来的模型和推理强度。' : '已回读确认：Claude Opus，推理强度' + ({ low: '轻度', medium: '中', high: '高', xhigh: '超高', max: '最高' }[value]) + (useNativeTools ? '，原生工具开启。' : '，客户端工具模式。') + '下次发送生效。';
      } catch (error) { message.textContent = String(error.message || '设置失败'); }
      finally { const blocked = id !== current() || running(); nativeTools.disabled = effort.disabled = blocked; save.disabled = blocked || !routerReady(); restore.disabled = blocked || !selection.selected(id); }
    }
    save.onclick = () => void change(effort.value); restore.onclick = () => void change(null);
    nativeTools.disabled = disabled;
    panel.append(title, dismiss, description, model, label, toolsLabel, toolsHelp, message, actions); document.body.append(panel);
  }
  function render() {
    const routing = document.querySelector('[data-codex-control-console-native-jev-current]');
    const host = routing?.parentElement;
    if (!host) { button?.remove(); return; }
    if (!button) {
      button = element('button'); button.type = 'button'; button.dataset.cccClaudePreview = ''; button.setAttribute('aria-label', 'Claude 预览设置');
      button.style.cssText = 'height:28px;flex:none;padding:0 10px;border:1px solid #ffffff24;border-radius:999px;background:transparent;color:inherit;font:600 12px system-ui;white-space:nowrap;';
      activateButton(button, open);
    }
    const id = current(), selected = selection.selected(id), text = selected ? 'Claude Opus ' + ({ low: '轻度', medium: '中', high: '高', xhigh: '超高', max: '最高' }[selected.effort]) + (selected.nativeTools ? ' 原生工具' : '') : 'Claude 预览';
    if (button.parentElement === host && button.textContent === text && button.getAttribute('aria-pressed') === String(Boolean(selected))) return;
    if (button.textContent !== text) button.textContent = text;
    button.setAttribute('aria-pressed', String(Boolean(selected)));
    button.style.color = selected ? '#62bd84' : '';
    button.title = '只修改当前本机会话的模型和强度';
    if (button.parentElement !== host) routing.after(button);
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 60); }
  window.__cccClaudePreviewRefresh = schedule;
  (window.__codexControlConsoleMutationSubscribers ||= new Set()).add(schedule);
  window.addEventListener('popstate', () => { close(); schedule(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  render();
}
