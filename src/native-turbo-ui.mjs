export function buildNativeTurboUiSource(bindingName) {
  const binding = JSON.stringify(bindingName);
  return `
  function turboLabel(value) {
    return String(value || '').replace(/^gpt-/i, '').replace(/-/g, ' ').replace(/\\b(sol|luna|terra)\\b/gi, (name) => name[0].toUpperCase() + name.slice(1).toLowerCase());
  }

  function renderButton(button) {
    const active = policy.enabled && policy.active;
    button.dataset.enabled = active ? 'true' : 'false';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.disabled = pending;
    const badges = [policy.fast ? 'Fast' : '', policy.millionContext ? '1M' : ''].filter(Boolean).join(' · ');
    button.title = pending ? '正在同步所有设备…' : policy.enabled && !policy.active ? 'Turbo 已开启，但这台设备不在作用范围内' : active ? 'Turbo 已开启：' + (badges || '使用自定义策略') + '；点击关闭' : '开启 Turbo';
    button.style.cssText = 'display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 7px;border:1px solid ' + (active ? 'rgba(232,173,33,.48)' : 'rgba(128,128,128,.24)') + ';border-radius:999px;background:' + (active ? 'rgba(232,173,33,.14)' : 'transparent') + ';color:' + (active ? '#d39a19' : 'currentColor') + ';font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1;white-space:nowrap;cursor:' + (pending ? 'wait' : 'pointer') + ';opacity:' + (pending ? '.58' : policy.enabled && !policy.active ? '.5' : '.82') + ';-webkit-app-region:no-drag;app-region:no-drag;';
    button.textContent = '';
    const icon = document.createElement('span'); icon.textContent = '⚡'; icon.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.textContent = 'Turbo';
    button.append(icon, text);
    if (policy.millionContext) { const badge = document.createElement('small'); badge.textContent = '1M'; badge.style.cssText = 'font-size:9px;opacity:.8'; button.append(badge); }
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
    if (!policy.enabled || !policy.active) { restoreReasoningControl(button); return; }
    const nativeText = String(button.textContent || '').replace(/\\s+/g, ' ').trim();
    const nativeModel = Array.from(policy.efforts.keys()).find((model) => nativeText.toLowerCase().includes(turboLabel(model).toLowerCase().split(' ').at(-1))) || '';
    const model = policy.model || nativeModel;
    const modelLabel = model ? turboLabel(model) : nativeText.replace(/\\s+(低|中|高|最高|low|medium|high|max|ultra)$/i, '');
    const effort = policy.reasoningEffort === 'preserve' ? '原强度' : policy.reasoningEffort === 'maximum' ? policy.efforts.get(model) || '最高' : policy.reasoningEffort;
    const parts = [modelLabel, effort, policy.fast ? 'Fast' : '', policy.millionContext ? '1M' : '', policy.accessMode !== 'preserve' ? ({ 'read-only':'只读', workspace:'工作区', 'full-access':'完全访问' }[policy.accessMode]) : ''].filter(Boolean);
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

  function closeSettings() { document.querySelector('[data-codex-control-console-turbo-popover]')?.remove(); }

  function addSelect(form, title, name, options, selected) {
    const label = document.createElement('label'); label.style.cssText = 'display:grid;gap:5px;font-size:12px;color:#b8b8bd'; label.textContent = title;
    const select = document.createElement('select'); select.name = name; select.style.cssText = 'width:100%;height:34px;padding:0 9px;border:1px solid #505055;border-radius:8px;background:#2d2d30;color:#f4f4f5;font:12px inherit;';
    for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; item.selected = option.value === selected; select.append(item); }
    label.append(select); form.append(label); return select;
  }

  function addSwitch(form, title, detail, name, checked) {
    const label = document.createElement('label'); label.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px;border-radius:9px;background:rgba(255,255,255,.05);cursor:pointer;';
    const copy = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title; strong.style.cssText = 'display:block;font-size:12px'; const small = document.createElement('small'); small.textContent = detail; small.style.cssText = 'display:block;margin-top:2px;color:#9f9fa5;font-size:10px'; copy.append(strong, small);
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.checked = checked; input.style.accentColor = '#d99a22'; label.append(copy, input); form.append(label); return input;
  }

  function openSettings(settingsButton) {
    const existing = document.querySelector('[data-codex-control-console-turbo-popover]'); if (existing) { existing.remove(); return; }
    const panel = document.createElement('div'); panel.setAttribute('data-codex-control-console-turbo-popover', ''); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Turbo 设置');
    panel.style.cssText = 'position:fixed;z-index:2147483646;width:330px;max-height:min(640px,calc(100vh - 30px));overflow:auto;padding:15px;border:1px solid rgba(128,128,128,.28);border-radius:14px;background:rgb(35,35,37);color:#f2f2f2;box-shadow:0 16px 46px rgba(0,0,0,.38);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:no-drag;app-region:no-drag;';
    const title = document.createElement('strong'); title.textContent = 'Turbo 策略'; title.style.cssText = 'display:block;margin-bottom:12px;font-size:14px';
    const form = document.createElement('form'); form.style.cssText = 'display:grid;gap:10px';
    const models = [{ value:'', label:'保持各会话原模型' }, ...policy.modelOptions.map((item) => ({ value:item.id, label:turboLabel(item.id) }))];
    const modelSelect = addSelect(form, '模型', 'model', models, policy.model || '');
    const reasoningSelect = addSelect(form, '推理强度', 'reasoningEffort', [], policy.reasoningEffort);
    const renderReasoning = () => {
      const selected = modelSelect.value; const modelOption = policy.modelOptions.find((item) => item.id === selected);
      const options = [{ value:'maximum', label:'该模型支持的最高强度' }, { value:'preserve', label:'保持会话原强度' }, ...(modelOption?.efforts || []).map((effort) => ({ value:effort, label:effort.toUpperCase() }))];
      const value = options.some((item) => item.value === reasoningSelect.value) ? reasoningSelect.value : 'maximum'; reasoningSelect.textContent = '';
      for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; item.selected = option.value === value; reasoningSelect.append(item); }
    };
    reasoningSelect.value = policy.reasoningEffort; renderReasoning(); modelSelect.addEventListener('change', renderReasoning);
    const fast = addSwitch(form, 'Fast 推理速度', '关闭后保持会话原速度', 'fast', policy.fast);
    const million = addSwitch(form, '百万上下文', '新一轮请求 1M', 'millionContext', policy.millionContext);
    const access = addSelect(form, '访问权限', 'accessMode', [{value:'preserve',label:'保持会话原权限'},{value:'read-only',label:'只读'},{value:'workspace',label:'工作区'},{value:'full-access',label:'完全访问'}], policy.accessMode);
    const allDevices = addSwitch(form, '全部设备', '关闭后可单独选择节点', 'allDevices', !policy.deviceIds.length);
    const deviceBox = document.createElement('div'); deviceBox.style.cssText = 'display:grid;gap:6px;padding:8px;border:1px solid #45454a;border-radius:9px';
    const deviceInputs = policy.devices.map((device) => { const label = document.createElement('label'); label.style.cssText = 'display:flex;align-items:center;gap:7px;font-size:11px'; const input = document.createElement('input'); input.type='checkbox'; input.value=device.id; input.checked=!policy.deviceIds.length || policy.deviceIds.includes(device.id); input.disabled=allDevices.checked; input.style.accentColor='#d99a22'; const text=document.createElement('span'); text.textContent=device.name; label.append(input,text); deviceBox.append(label); return input; });
    allDevices.addEventListener('change', () => { for (const input of deviceInputs) input.disabled = allDevices.checked; }); form.append(deviceBox);
    const save = document.createElement('button'); save.type='submit'; save.textContent='保存并同步'; save.style.cssText='height:36px;margin-top:2px;border:0;border-radius:9px;background:#d99a22;color:#1d1608;font-weight:700;cursor:pointer'; form.append(save);
    form.addEventListener('submit', (event) => {
      event.preventDefault(); const targetIds = allDevices.checked ? [] : deviceInputs.filter((input) => input.checked).map((input) => input.value); if (!allDevices.checked && !targetIds.length) return;
      const action = { model:modelSelect.value || null, reasoningEffort:reasoningSelect.value, fast:fast.checked, millionContext:million.checked, accessMode:access.value, deviceIds:targetIds };
      const bindingFn = window[${binding}]; if (pending || typeof bindingFn !== 'function') return; pending=true; closeSettings(); const turbo=document.querySelector('[data-codex-control-console-native-turbo]'); if (turbo) renderButton(turbo);
      try { bindingFn(JSON.stringify(action)); } catch { pending=false; if (turbo) renderButton(turbo); }
    });
    panel.append(title, form); document.body.append(panel); const rect=settingsButton.getBoundingClientRect(); panel.style.top=Math.max(12,Math.min(window.innerHeight-panel.offsetHeight-12,rect.bottom+8))+'px'; panel.style.left=Math.max(12,Math.min(window.innerWidth-panel.offsetWidth-12,rect.right-panel.offsetWidth))+'px';
    setTimeout(() => document.addEventListener('pointerdown', (event) => { if (!panel.contains(event.target) && event.target !== settingsButton) closeSettings(); }, { once:true }), 0);
  }

  function installButton() {
    const search=document.querySelector('button[aria-label="搜索"],button[aria-label="Search"]'); const host=search?.parentElement?.parentElement?.parentElement; if (!host || !host.classList?.contains('ms-auto')) return;
    let button=document.querySelector('[data-codex-control-console-native-turbo]'); if (!button) { button=document.createElement('button'); button.type='button'; button.setAttribute('data-codex-control-console-native-turbo',''); button.setAttribute('aria-label','Turbo 模式'); button.addEventListener('click',(event)=>{ event.preventDefault();event.stopPropagation();const bindingFn=window[${binding}];if(pending||typeof bindingFn!=='function')return;pending=true;renderButton(button);try{bindingFn(JSON.stringify({enabled:!policy.enabled}));}catch{pending=false;renderButton(button);}}); }
    renderButton(button); if(button.parentElement!==host)host.insertBefore(button,host.firstChild);
    let settings=document.querySelector('[data-codex-control-console-native-turbo-settings]'); if(!settings){settings=document.createElement('button');settings.type='button';settings.setAttribute('data-codex-control-console-native-turbo-settings','');settings.setAttribute('aria-label','Turbo 设置');settings.title='Turbo 设置';settings.textContent='⚙';settings.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:1px solid rgba(128,128,128,.2);border-radius:999px;background:transparent;color:currentColor;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;opacity:.72;-webkit-app-region:no-drag;app-region:no-drag;';settings.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();openSettings(settings);});} if(settings.parentElement!==host)host.insertBefore(settings,button.nextSibling);
  }
`;
}
