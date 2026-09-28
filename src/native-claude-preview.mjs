import { createClaudePreviewSelection } from './claude-preview-selection.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';
import { installNativeJevButtonActivation } from './native-jev-button-activation.mjs';

export function buildNativeClaudePreviewInjectionScript() {
  return `(${installClaudePreview.toString()})(${createClaudePreviewSelection.toString()}, ${readNativeComposerThreadId.toString()}, ${installNativeJevButtonActivation.toString()})`;
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
    const description = element('p', '当前会话使用 Claude 订阅，通过客户端现有工具读写文件、运行命令和操作界面，沿用会话权限。支持图片和工具历史；压缩前的本地记录会按需恢复，较早内容可继续回查。');
    const model = element('p', '模型：Claude Opus');
    const label = element('label', '推理强度 '), effort = element('select'); effort.setAttribute('aria-label', 'Claude 推理强度');
    for (const [value, text] of [['low', '轻度'], ['medium', '中'], ['high', '高']]) { const option = element('option', text); option.value = value; effort.append(option); }
    effort.value = selected?.effort || 'medium'; label.append(effort);
    const message = element('p', id ? '只修改当前会话；不改变全局模型和访问权限。' : '请先打开一个本机 Codex 会话。新建聊天尚未生成会话 ID 时不可切换。'); message.setAttribute('role', 'status');
    const save = element('button', '当前会话使用 Claude'), restore = element('button', '恢复原生模型');
    save.type = restore.type = 'button';
    const disabled = !id || running() || selection.busy(id);
    save.disabled = disabled; restore.disabled = disabled || !selected;
    if (!routerReady()) { save.disabled = true; message.textContent = '请先在路由设置中启用 Router 通道；原生直连不能使用 Claude 预览。'; }
    if (running()) message.textContent = '当前会话正在生成，请结束后再切换。';
    async function change(value) {
      if (value !== null && !routerReady()) { message.textContent = 'Router 通道尚未就绪，未修改模型。'; return; }
      if (id !== current() || running()) { message.textContent = '会话已切换或正在生成，请重新打开设置。'; return; }
      save.disabled = restore.disabled = true;
      try {
        await selection.set(id, value);
        message.textContent = value === null ? '已回读确认：恢复原来的模型和推理强度。' : '已回读确认：Claude Opus，推理强度' + ({ low: '轻度', medium: '中', high: '高' }[value]) + '。下一次发送将使用预览路由。';
      } catch (error) { message.textContent = String(error.message || '设置失败'); }
      finally { const blocked = id !== current() || running(); save.disabled = blocked || !routerReady(); restore.disabled = blocked || !selection.selected(id); }
    }
    save.onclick = () => void change(effort.value); restore.onclick = () => void change(null);
    panel.append(title, dismiss, description, model, label, message, save, restore); document.body.append(panel);
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
    const id = current(), selected = selection.selected(id), text = selected ? 'Claude Opus ' + ({ low: '轻度', medium: '中', high: '高' }[selected.effort]) : 'Claude 预览';
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
