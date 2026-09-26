import { buildNativeTurboSettingsSource } from "./native-turbo-settings-ui.mjs";

export function buildNativeTurboUiSource() {
  return `
  function turboLabel(value) {
    return String(value || '').replace(/^gpt-/i, '').replace(/-/g, ' ').replace(/\\b(sol|luna|terra)\\b/gi, (name) => name[0].toUpperCase() + name.slice(1).toLowerCase());
  }

  function renderButton(button) {
    const active = policy.enabled && policy.active;
    const enforced = !active || typeof turboIsEnforcedForCurrentThread !== 'function' || turboIsEnforcedForCurrentThread();
    const badges = [policy.fast ? 'Fast' : '', policy.millionContext ? '1M' : ''].filter(Boolean).join(' · ');
    const title = pending ? (state.turboActionPending?.operation === 'save' ? '正在保存到本机…' : '正在同步所有设备…') : active && !enforced ? '正在把 Turbo 策略应用到当前原生会话…' : active ? 'Turbo 已开启：' + (badges || '使用自定义策略') + '；点击关闭' : '开启 Turbo';
    const signature = [active, enforced, pending, title].join(':');
    if (button.getAttribute('data-codex-control-console-turbo-render-signature') === signature) return;
    button.setAttribute('data-codex-control-console-turbo-render-signature', signature);
    button.dataset.enabled = active ? 'true' : 'false';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.setAttribute('aria-label', active ? 'Turbo 模式已开启' : 'Turbo 模式已关闭');
    button.disabled = pending;
    button.title = title + '；右键打开设置';
    button.style.cssText = 'display:inline-flex;flex:0 0 28px;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid ' + (active ? 'rgba(232,173,33,.48)' : 'rgba(128,128,128,.24)') + ';border-radius:8px;background:' + (active ? 'rgba(232,173,33,.14)' : 'transparent') + ';color:' + (active ? '#d39a19' : 'currentColor') + ';cursor:' + (pending ? 'wait' : 'pointer') + ';opacity:' + (pending ? '.58' : '.82') + ';-webkit-app-region:no-drag;app-region:no-drag;';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('width', '17'); icon.setAttribute('height', '17');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.8');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    const bolt = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bolt.setAttribute('d', 'M13 2 5 13h6l-1 9 9-13h-6V2z'); icon.append(bolt);
    button.replaceChildren(icon);
  }

  function restoreReasoningControl(button) {
    button.querySelector('[data-codex-control-console-turbo-effective]')?.remove();
    for (const child of Array.from(button.children)) {
      if (!child.hasAttribute('data-codex-control-console-turbo-visibility')) continue;
      child.style.visibility = child.getAttribute('data-codex-control-console-turbo-visibility') || '';
      child.removeAttribute('data-codex-control-console-turbo-visibility');
    }
    if (button.hasAttribute('data-codex-control-console-turbo-style')) {
      const style = button.getAttribute('data-codex-control-console-turbo-style');
      if (style) button.setAttribute('style', style); else button.removeAttribute('style');
      button.removeAttribute('data-codex-control-console-turbo-style');
    }
    const title = button.getAttribute('data-codex-control-console-turbo-title');
    if (button.hasAttribute('data-codex-control-console-turbo-title')) { if (title) button.title = title; else button.removeAttribute('title'); button.removeAttribute('data-codex-control-console-turbo-title'); }
    button.removeAttribute('data-codex-control-console-turbo-effective-state');
  }

  function decorateReasoningControl() {
    const button = document.querySelector('[data-composer-navigation-target="reasoning"]');
    if (!button) return;
    if (!policy.enabled || !policy.active || (typeof turboIsEnforcedForCurrentThread === 'function' && !turboIsEnforcedForCurrentThread())) { restoreReasoningControl(button); return; }
    const nativeText = String(button.textContent || '').replace(/\\s+/g, ' ').trim();
    const nativeModel = Array.from(policy.efforts.keys()).find((model) => nativeText.toLowerCase().includes(turboLabel(model).toLowerCase().split(' ').at(-1))) || '';
    const model = policy.model || nativeModel;
    const modelLabel = model ? turboLabel(model) : nativeText.replace(/\\s+(低|中|高|最高|low|medium|high|max|ultra)$/i, '');
    const effort = policy.reasoningEffort === 'preserve' ? '原强度' : policy.reasoningEffort === 'maximum' ? policy.efforts.get(model) || '最高' : policy.reasoningEffort;
    const parts = [modelLabel, effort, policy.fast ? 'Fast' : '', policy.millionContext ? '1M' : ''].filter(Boolean);
    const state = parts.join(':');
    if (button.getAttribute('data-codex-control-console-turbo-effective-state') === state && button.querySelector('[data-codex-control-console-turbo-effective]')) return;
    restoreReasoningControl(button);
    button.setAttribute('data-codex-control-console-turbo-style', button.getAttribute('style') || '');
    button.setAttribute('data-codex-control-console-turbo-title', button.getAttribute('title') || '');
    for (const child of Array.from(button.children)) { child.setAttribute('data-codex-control-console-turbo-visibility', child.style.visibility || ''); child.style.visibility = 'hidden'; }
    button.style.position = 'relative'; button.style.minWidth = Math.max(142, parts.join(' ').length * 7 + 22) + 'px';
    button.style.borderColor = 'rgba(232,173,33,.42)'; button.style.background = 'rgba(232,173,33,.12)'; button.style.color = '#d39a19';
    button.title = 'Turbo 当前有效策略；关闭后恢复会话原设置';
    const effective = document.createElement('span');
    effective.setAttribute('data-codex-control-console-turbo-effective', '');
    effective.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 8px;visibility:visible;color:inherit;font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;pointer-events:none;';
    for (const part of parts) { const item = document.createElement('span'); item.textContent = part; effective.append(item); }
    button.append(effective); button.setAttribute('data-codex-control-console-turbo-effective-state', state);
  }

  function makeTurboHeaderInteractive(host) {
    const row = host?.parentElement;
    if (!row) return;
    if (!row.hasAttribute('data-codex-control-console-interactive-header')) row.setAttribute('data-codex-control-console-interactive-header', '');
    for (const element of [row, host]) {
      if (element.style.getPropertyValue('-webkit-app-region') !== 'drag' || element.style.getPropertyPriority('-webkit-app-region') !== 'important') element.style.setProperty('-webkit-app-region', 'drag', 'important');
      if (element.style.getPropertyValue('app-region') !== 'drag' || element.style.getPropertyPriority('app-region') !== 'important') element.style.setProperty('app-region', 'drag', 'important');
    }
    for (const element of row.querySelectorAll('button,[role="button"]')) {
      if (element.style.getPropertyValue('-webkit-app-region') !== 'no-drag' || element.style.getPropertyPriority('-webkit-app-region') !== 'important') element.style.setProperty('-webkit-app-region', 'no-drag', 'important');
      if (element.style.getPropertyValue('app-region') !== 'no-drag' || element.style.getPropertyPriority('app-region') !== 'important') element.style.setProperty('app-region', 'no-drag', 'important');
      if (element.style.getPropertyValue('pointer-events') !== 'auto' || element.style.getPropertyPriority('pointer-events') !== 'important') element.style.setProperty('pointer-events', 'auto', 'important');
    }
  }

  ${buildNativeTurboSettingsSource()}

  function installButton() {
    renderTurboSettingsResult();
    const search=document.querySelector('button[aria-label="搜索"],button[aria-label="Search"]'); const host=search?.parentElement?.parentElement?.parentElement; if (!host || !host.classList?.contains('ms-auto')) return;
    makeTurboHeaderInteractive(host);
    let button=document.querySelector('[data-codex-control-console-native-turbo]'); if (!button) { button=document.createElement('button'); button.type='button'; button.setAttribute('data-codex-control-console-native-turbo',''); button.setAttribute('aria-label','Turbo 模式'); button.addEventListener('click',(event)=>{ event.preventDefault();event.stopPropagation();turboSend({enabled:!policy.enabled});}); button.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); openSettings(button); }); }
    renderButton(button); if(button.parentElement!==host)host.insertBefore(button,host.firstChild);
    for (const control of [button]) {
      if (control.hasAttribute('data-codex-control-console-turbo-hover')) continue;
      control.setAttribute('data-codex-control-console-turbo-hover', '');
      control.addEventListener('mouseenter', () => { control.style.filter = 'brightness(1.22)'; control.style.opacity = '1'; });
      control.addEventListener('mouseleave', () => { control.style.filter = ''; renderButton(button); });
    }
    makeTurboHeaderInteractive(host);
  }
`;
}
