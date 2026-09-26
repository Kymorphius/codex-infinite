export function buildNativeTurboSettingsSource() {
  return `
  function addSelect(form, title, name, options, selected) {
    const label = document.createElement('label'); label.style.cssText = 'display:grid;gap:5px;font-size:12px;color:#b8b8bd'; label.textContent = title;
    const select = document.createElement('select'); select.name = name; select.style.cssText = 'width:100%;height:34px;padding:0 9px;border:1px solid #505055;border-radius:8px;background:#2d2d30;color:#f4f4f5;font:12px inherit;';
    for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; item.selected = option.value === selected; select.append(item); }
    label.append(select); form.append(label); return select;
  }

  function addSwitch(form, title, detail, name, checked) {
    const label = document.createElement('label'); label.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px;border-radius:9px;background:rgba(255,255,255,.05);cursor:pointer;pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;user-select:none;';
    const copy = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title; strong.style.cssText = 'display:block;font-size:12px'; const small = document.createElement('small'); small.textContent = detail; small.style.cssText = 'display:block;margin-top:2px;color:#9f9fa5;font-size:10px'; copy.append(strong, small);
    const track = document.createElement('span'); track.setAttribute('data-codex-control-console-turbo-switch-track', name); track.style.cssText = 'position:relative;flex:0 0 auto;width:34px;height:20px;border:1px solid rgba(255,255,255,.24);border-radius:999px;transition:background .14s ease,border-color .14s ease;pointer-events:none;';
    const thumb = document.createElement('span'); thumb.style.cssText = 'position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#d7d7dc;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .14s ease,background .14s ease;'; track.append(thumb);
    const input = document.createElement('input'); input.type = 'checkbox'; input.name = name; input.checked = checked; input.setAttribute('aria-label', title); input.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;pointer-events:auto;-webkit-app-region:no-drag;app-region:no-drag;';
    const render = () => { track.style.background = input.checked ? 'rgba(217,154,34,.9)' : 'rgba(255,255,255,.08)'; track.style.borderColor = input.checked ? 'rgba(237,184,64,.8)' : 'rgba(255,255,255,.24)'; thumb.style.transform = input.checked ? 'translateX(14px)' : 'translateX(0)'; thumb.style.background = input.checked ? '#fff4d0' : '#d7d7dc'; label.setAttribute('data-checked', input.checked ? 'true' : 'false'); };
    input.addEventListener('change', render); label.append(copy, track, input); form.append(label); render(); return input;
  }

  let turboSettingsView = null;

  function closeSettings() {
    if (state.turboActionPending) return;
    const view = turboSettingsView;
    if (view) { document.removeEventListener('pointerdown', view.outside); document.removeEventListener('keydown', view.escape); }
    document.querySelector('[data-codex-control-console-turbo-popover]')?.remove();
    turboSettingsView = null;
  }

  function renderTurboSettingsResult() {
    const view = turboSettingsView;
    if (!view) return;
    const action = state.turboActionPending;
    const result = state.turboActionResult;
    const signature = JSON.stringify([action, result, view.validationError, view.modified, view.autoDisableOnLowQuota.checked, policy.enabled, policy.active, policy.autoDisableOnLowQuota, policy.quotaRemainingThreshold, policy.quotaStatus]);
    if (view.signature === signature) return;
    view.signature = signature;
    for (const button of [view.save, view.sync]) { button.disabled = Boolean(action); button.style.opacity = action ? '.55' : '1'; button.style.cursor = action ? 'wait' : 'pointer'; }
    for (const control of view.controls) control.disabled = Boolean(action) || (control === view.quotaThreshold && !view.autoDisableOnLowQuota.checked);
    const quota = policy.quotaStatus;
    const quotaState = quota?.state || (policy.autoDisableOnLowQuota === false ? 'disabled' : !policy.enabled || !policy.active ? 'inactive' : 'unknown');
    const remaining = typeof quota?.remainingPercent === 'number' ? Math.round(quota.remainingPercent * 100) / 100 + '%' : '未知';
    const threshold = quota?.thresholdPercent ?? policy.quotaRemainingThreshold ?? 10;
    view.quotaStatus.textContent = quotaState === 'disabled' ? '额度自动关闭已停用。' : quotaState === 'inactive' ? 'Turbo 当前未在本机生效，额度监测暂停。' : quotaState === 'healthy' ? '本机账号最低剩余额度 ' + remaining + '；触发阈值 ' + threshold + '%。' : quotaState === 'triggered' ? '本机账号剩余额度 ' + remaining + '，已达到 ' + threshold + '% 阈值，Turbo 已自动关闭。' : '暂时无法读取本机账号额度，等待下次检查。';
    view.panel.setAttribute('aria-busy', action ? 'true' : 'false');
    view.results.replaceChildren();
    if (action) { view.status.textContent = action.operation === 'save' ? '正在保存到本机…' : '正在保存并同步到所有设备…'; return; }
    if (view.validationError) { view.status.textContent = view.validationError; return; }
    if (view.modified) { view.status.textContent = '设置已修改，尚未保存。'; return; }
    if (!result) { view.status.textContent = '保存仅更新本机；同步会发送到所有设备。'; return; }
    const saving = result.operation === 'save';
    if (result.error) { view.status.textContent = (saving ? '保存失败：' : '同步失败：') + String(result.error); return; }
    const nodes = Array.isArray(result.nodes) ? result.nodes : [];
    const complete = saving ? nodes.length > 0 && nodes.every((node) => node.status === 'applied') : result.converged === true;
    view.status.textContent = saving ? (complete ? '已保存到本机。' : '本机保存未全部完成，请查看结果。') : (complete ? '已同步到所有设备。' : '同步未全部完成，请查看各设备结果后重试。');
    for (const node of nodes) {
      const row = document.createElement('div'); row.style.cssText = 'padding:6px 0;border-top:1px solid rgba(255,255,255,.08);overflow-wrap:anywhere';
      const label = node.status === 'applied' ? (saving ? '已保存' : '已同步') : node.status === 'mismatch' ? '设置不一致' : ['failed','error'].includes(node.status) ? '失败' : '未确认';
      row.textContent = String(node.name || node.id || '设备') + '：' + label;
      const detail = node.message || node.error;
      if (detail) { const text = document.createElement('div'); text.style.cssText = 'margin-top:3px;color:#b8b8bd'; text.textContent = String(detail); row.append(text); }
      view.results.append(row);
    }
  }

  function openSettings(settingsButton) {
    const existing = document.querySelector('[data-codex-control-console-turbo-popover]'); if (existing) { closeSettings(); return; }
    const panel = document.createElement('div'); panel.setAttribute('data-codex-control-console-turbo-popover', ''); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Turbo 设置');
    panel.style.cssText = 'position:fixed;z-index:2147483646;width:330px;max-height:min(640px,calc(100vh - 30px));overflow:auto;padding:15px;border:1px solid rgba(128,128,128,.28);border-radius:14px;background:rgb(35,35,37);color:#f2f2f2;box-shadow:0 16px 46px rgba(0,0,0,.38);font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto!important;-webkit-app-region:no-drag!important;app-region:no-drag!important;';
    const title = document.createElement('strong'); title.textContent = 'Turbo 策略'; title.style.cssText = 'display:block;margin-bottom:12px;font-size:14px';
    const form = document.createElement('form'); form.noValidate = true; form.style.cssText = 'display:grid;gap:10px';
    const models = [{ value:'', label:'保持各会话原模型' }, ...policy.modelOptions.map((item) => ({ value:item.id, label:turboLabel(item.id) }))];
    if (policy.model && !models.some((item) => item.value === policy.model)) models.push({ value:policy.model, label:turboLabel(policy.model) });
    const modelSelect = addSelect(form, '模型', 'model', models, policy.model || '');
    const reasoningSelect = addSelect(form, '推理强度', 'reasoningEffort', [], policy.reasoningEffort);
    const renderReasoning = (preferred = reasoningSelect.value) => {
      const modelOption = policy.modelOptions.find((item) => item.id === modelSelect.value);
      const options = [{ value:'maximum', label:'该模型支持的最高强度' }, { value:'preserve', label:'保持会话原强度' }, ...(modelOption?.efforts || []).map((effort) => ({ value:effort, label:effort.toUpperCase() }))];
      if (!modelOption?.efforts?.length && preferred && !options.some((item) => item.value === preferred)) options.push({ value:preferred,label:preferred.toUpperCase() });
      const value = options.some((item) => item.value === preferred) ? preferred : 'maximum'; reasoningSelect.textContent = '';
      for (const option of options) { const item = document.createElement('option'); item.value = option.value; item.textContent = option.label; item.selected = option.value === value; reasoningSelect.append(item); }
    };
    renderReasoning(policy.reasoningEffort); modelSelect.addEventListener('change', () => renderReasoning());
    const fast = addSwitch(form, 'Fast 推理速度', '关闭后保持会话原速度', 'fast', policy.fast);
    const million = addSwitch(form, '百万上下文', '新一轮请求 1M', 'millionContext', policy.millionContext);
    const autoDisableGlobalRouting = addSwitch(form, '自动关闭全局路由', 'Turbo 开启时关闭 Jev 全局路由', 'autoDisableGlobalRouting', policy.autoDisableGlobalRouting);
    const autoDisableOnLowQuota = addSwitch(form, '额度不足时自动关闭 Turbo', '本机账号任一额度窗口剩余不高于阈值时关闭', 'autoDisableOnLowQuota', policy.autoDisableOnLowQuota !== false);
    const quotaLabel = document.createElement('label'); quotaLabel.textContent = '剩余额度阈值（%）'; quotaLabel.style.cssText = 'display:grid;gap:5px;font-size:12px;color:#b8b8bd';
    const quotaThreshold = document.createElement('input'); quotaThreshold.type = 'number'; quotaThreshold.name = 'quotaRemainingThreshold'; quotaThreshold.min = '0'; quotaThreshold.max = '100'; quotaThreshold.step = '1'; quotaThreshold.value = String(policy.quotaRemainingThreshold ?? 10); quotaThreshold.setAttribute('aria-label', '剩余额度阈值（%）'); quotaThreshold.style.cssText = 'box-sizing:border-box;width:100%;height:34px;padding:0 9px;border:1px solid #505055;border-radius:8px;background:#2d2d30;color:#f4f4f5;font:12px inherit'; quotaLabel.append(quotaThreshold); form.append(quotaLabel);
    const quotaStatus = document.createElement('div'); quotaStatus.setAttribute('data-turbo-quota-status', ''); quotaStatus.setAttribute('aria-live', 'polite'); quotaStatus.style.cssText = 'font-size:11px;color:#b8b8bd;line-height:1.5';
    const quotaNote = document.createElement('small'); quotaNote.textContent = '仅自动关闭本机 Turbo；额度恢复后不会自动开启。'; quotaNote.style.cssText = 'font-size:11px;color:#a9a9ae;line-height:1.5'; form.append(quotaStatus, quotaNote);
    const actions = document.createElement('div'); actions.style.cssText = 'display:grid;grid-template-columns:1fr 1.5fr;gap:8px;margin-top:2px';
    const save = document.createElement('button'); save.type='submit'; save.textContent='保存'; save.setAttribute('data-turbo-operation','save'); save.style.cssText='height:36px;border:0;border-radius:9px;background:#d99a22;color:#1d1608;font-weight:700;cursor:pointer';
    const sync = document.createElement('button'); sync.type='button'; sync.textContent='同步到所有设备'; sync.setAttribute('data-turbo-operation','sync'); sync.style.cssText='height:36px;border:1px solid #b68832;border-radius:9px;background:transparent;color:#f1c776;font-weight:600;cursor:pointer'; actions.append(save,sync); form.append(actions);
    const status = document.createElement('div'); status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); status.style.cssText='font-size:11px;line-height:1.6;color:#d8d8dc;overflow-wrap:anywhere';
    const results = document.createElement('div'); results.setAttribute('data-turbo-device-results',''); results.style.cssText='font-size:11px;line-height:1.5'; form.append(status,results);
    const submit = (operation) => {
      if (pending || state.turboActionPending) return;
      const quotaRemainingThreshold = Number(quotaThreshold.value);
      if (!String(quotaThreshold.value).trim() || !Number.isInteger(quotaRemainingThreshold) || quotaRemainingThreshold < 0 || quotaRemainingThreshold > 100) { turboSettingsView.validationError = '剩余额度阈值请输入 0 到 100 的整数。'; renderTurboSettingsResult(); return; }
      turboSettingsView.validationError = ''; turboSettingsView.modified = false;
      const action = { model:modelSelect.value || null, reasoningEffort:reasoningSelect.value, fast:fast.checked, millionContext:million.checked, autoDisableGlobalRouting:autoDisableGlobalRouting.checked, autoDisableOnLowQuota:autoDisableOnLowQuota.checked, quotaRemainingThreshold, deviceIds:[] };
      turboSend(action, operation); renderTurboSettingsResult();
    };
    form.addEventListener('submit', (event) => { event.preventDefault(); submit('save'); });
    sync.addEventListener('click', () => submit('sync'));
    form.addEventListener('change', () => { if (!state.turboActionPending) { turboSettingsView.modified = true; turboSettingsView.validationError = ''; renderTurboSettingsResult(); } });
    quotaThreshold.addEventListener('input', () => { if (!state.turboActionPending) { turboSettingsView.modified = true; turboSettingsView.validationError = ''; renderTurboSettingsResult(); } });
    const outside = (event) => { if (!panel.contains(event.target) && event.target !== settingsButton) closeSettings(); };
    const escape = (event) => { if (event.key === 'Escape') closeSettings(); };
    turboSettingsView = { panel, save, sync, status, results, quotaStatus, quotaThreshold, autoDisableOnLowQuota, outside, escape, controls:[modelSelect,reasoningSelect,fast,million,autoDisableGlobalRouting,autoDisableOnLowQuota,quotaThreshold], modified:false, validationError:'', signature:'' };
    panel.append(title, form); document.body.append(panel); renderTurboSettingsResult(); const rect=settingsButton.getBoundingClientRect(); panel.style.top=Math.max(12,Math.min(window.innerHeight-panel.offsetHeight-12,rect.bottom+8))+'px'; panel.style.left=Math.max(12,Math.min(window.innerWidth-panel.offsetWidth-12,rect.right-panel.offsetWidth))+'px';
    setTimeout(() => { if (turboSettingsView?.panel !== panel) return; document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); }, 0);
  }
`;
}
