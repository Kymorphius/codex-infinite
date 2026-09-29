// Model / effort / ultracode picker in a Claude terminal conversation's composer footer. Looks
// like the native composer's model pill and opens upward like 更多按键. It only edits the stored
// choice through the terminal `update` request; the server passes it as launch flags or types it
// into an idle Claude. Needs claudeTerminalCatalog (claude-terminal-settings.mjs) in the page.
export function installNativeTerminalModelPicker() {
  window.__cccCreateNativeTerminalModelPicker = ({ record, api, root }) => {
    if (record?.kind !== 'claude' || typeof claudeTerminalCatalog !== 'function') return null;
    const catalog = claudeTerminalCatalog(), models = new Map(catalog.models.map(model => [model.id, model]));
    const el = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
    const short = model => model.name.replace(/（[^）]*）/gu, '').trim();
    let current = record, open = false, saving = false, error = '', disposed = false;
    const wrap = el('div', 'model-picker'), trigger = el('button', 'pill model-pill'), label = el('span', 'model-label');
    trigger.type = 'button'; trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
    trigger.append(label);
    trigger.insertAdjacentHTML?.('beforeend', '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
    const menu = el('div', 'model-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Claude 模型与推理强度'); menu.hidden = true;
    const rows = [], efforts = el('div', 'effort-seg'), note = el('p', 'model-note');
    efforts.setAttribute('role', 'radiogroup'); efforts.setAttribute('aria-label', '推理强度');
    menu.append(el('span', 'model-heading', '模型'));
    for (const [index, model] of catalog.models.entries()) {
      if (model.dynamic && !catalog.models[index - 1]?.dynamic) menu.append(el('span', 'model-heading', '别名（随 Claude 更新）'));
      const row = el('button', 'model-row'); row.type = 'button'; row.tabIndex = -1; row.dataset.model = model.id;
      row.setAttribute('role', 'menuitemradio'); row.append(el('span', '', model.name)); row.title = model.cliModel;
      row.onclick = () => void choose({ model: model.id }); rows.push(row); menu.append(row);
    }
    const effortButtons = catalog.efforts.map(effort => {
      const button = el('button', '', catalog.effortLabels[effort]); button.type = 'button'; button.dataset.effort = effort;
      button.setAttribute('role', 'radio'); button.title = effort === 'auto' ? '自动：不传 --effort，由 Claude 决定' : effort;
      button.onclick = () => void choose({ effort }); efforts.append(button); return button;
    });
    const ultra = el('button', 'model-row ultra'), ultraText = el('span'), ultraSwitch = el('span', 'switch');
    ultra.type = 'button'; ultra.tabIndex = -1; ultra.setAttribute('role', 'menuitemcheckbox');
    ultraText.append('Ultracode', el('small', 'model-detail', '仅本会话有效；恢复会话后自动重新开启'));
    ultra.append(ultraText, ultraSwitch); ultra.onclick = () => void choose({ ultracode: !(shown()?.ultracode === true) });
    menu.append(el('span', 'model-heading', '推理强度'), efforts, el('div', 'model-divider'), ultra, note); wrap.append(trigger, menu);

    // Stored choice first; otherwise what Claude reported using (read back from its transcript).
    const shown = () => current.claudeSettings || (current.claudeObserved && { ...current.claudeObserved, ultracode: current.claudeObserved.ultracode === true }) || null;
    const readOnly = () => current.claudeSettingsReadOnly || null;
    function describe() {
      const value = shown(), model = value && models.get(value.model), effort = value && catalog.effortLabels[value.effort];
      if (!model && !effort) return 'Claude 默认';
      const unset = current.claudeSettings && value.model === null ? 'Claude 默认' : 'Claude';
      return [model ? short(model) : unset, effort, value.ultracode ? 'Ultracode' : ''].filter(Boolean).join(' · ');
    }
    function hint() {
      if (error) return error;
      if (readOnly() === 'companion') return '伴生会话的模型由 Router 决定，此处只读';
      if (readOnly() === 'attach') return '后台共享打开的会话沿用它启动时的模型，此处只读';
      if (readOnly() === 'elsewhere') return '会话正在其他 Claude 进程中运行，此处只读；在这里打开后再选择';
      if (!current.claudeSettings) return current.claudeObserved ? '显示 Claude 最近使用的设置；选择后按会话保存' : '未设置时使用 Claude 默认；选择后按会话保存';
      if (current.status !== 'running') return '下次启动或恢复会话时生效';
      return current.claudeSettingsPending ? '等待 Claude 空闲且输入行为空后切换…' : 'Claude 空闲时自动切换，不打断当前回合';
    }
    // Read-only disables the controls; saving only marks them aria-disabled (choose ignores clicks
    // meanwhile), so the focused control keeps focus and the keyboard keeps working.
    function render() {
      const value = shown(), locked = Boolean(readOnly()), text = describe();
      label.textContent = text; trigger.title = `Claude 模型与推理强度：${text}`; trigger.setAttribute('data-readonly', String(locked));
      const mark = (node, disabled) => { node.disabled = disabled; node.setAttribute('aria-disabled', String(disabled || saving)); };
      for (const row of rows) { row.setAttribute('aria-checked', String(value?.model === row.dataset.model)); mark(row, locked); }
      const autoOnly = Boolean(value && models.get(value.model)?.autoOnly);
      for (const button of effortButtons) {
        const checked = value?.effort === button.dataset.effort || (!value?.effort && button.dataset.effort === 'auto');
        button.setAttribute('aria-checked', String(checked)); button.tabIndex = checked ? 0 : -1;
        mark(button, locked || (autoOnly && button.dataset.effort !== 'auto'));
      }
      efforts.title = autoOnly ? '这个模型只能使用自动推理强度' : '';
      ultra.setAttribute('aria-checked', String(value?.ultracode === true)); mark(ultra, locked);
      note.textContent = hint(); note.setAttribute('data-tone', error ? 'bad' : 'muted');
      wrap.setAttribute('aria-busy', String(saving));
    }
    function setOpen(value, focus = false) {
      open = value; menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
      if (open && focus) (rows.find(row => row.getAttribute('aria-checked') === 'true') || rows[0]).focus?.();
      if (!open && focus) trigger.focus?.();
    }
    const update = value => { if (!disposed && value?.id === current.id) { current = value; render(); } };
    // The clicked change on top of what is shown now. No known model stays unset (Claude's default).
    function settingsWith(change) {
      const base = shown() || {};
      const next = { model: models.has(base.model) ? base.model : null, effort: base.effort || 'auto', ultracode: base.ultracode === true, ...change };
      if (models.get(next.model)?.autoOnly) next.effort = 'auto';
      return next;
    }
    async function save(change) {
      const input = () => ({ id: current.id, expectedRevision: current.revision, claudeSettings: settingsWith(change) });
      try { return await api.request('update', input()); }
      catch (failure) {
        // Someone else (or a read-back from Claude) changed the record: take the latest and apply
        // only the clicked change to it, once, so the other change is not overwritten.
        if (!/已变更/u.test(failure?.message || '')) throw failure;
        update((await api.request('open', { id: current.id })).conversation);
        if (readOnly()) throw Error(hint());
        return api.request('update', input());
      }
    }
    async function choose(change) {
      if (readOnly() || saving || disposed) return;
      saving = true; error = ''; render();
      try {
        const result = await save(change);
        if (!disposed) { window.__cccTerminalConversations?.accept?.(result.conversation); update(result.conversation); }
      } catch (failure) { error = failure?.message || '未能保存 Claude 设置'; }
      finally { saving = false; if (!disposed) render(); }
    }
    trigger.onclick = () => setOpen(!open);
    // Keys on the wrapper see both the trigger and the menu: Escape closes whichever has focus.
    wrap.onkeydown = event => {
      if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation?.(); setOpen(false, true); return; }
      if (event.target === trigger && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) { event.preventDefault(); setOpen(true, true); return; }
      const items = [...rows, ultra], index = items.indexOf(event.target), choice = effortButtons.indexOf(event.target);
      if (choice >= 0 && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const next = effortButtons[choice + (event.key === 'ArrowLeft' ? -1 : 1)];
        if (next && !next.disabled && !saving) { next.focus?.(); void choose({ effort: next.dataset.effort }); }
      } else if (index >= 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus?.();
      }
    };
    // Any click outside (the composer, the relocated title bar, the native sidebar) or leaving the window closes it.
    const outside = event => { if (open && !event.composedPath?.().includes(wrap)) setOpen(false); }, blur = () => { if (open) setOpen(false); };
    for (const target of [root, document]) target?.addEventListener?.('pointerdown', outside, true);
    window.addEventListener?.('blur', blur);
    render();
    return { element: wrap, update, close: () => setOpen(false),
      dispose() { disposed = true; for (const target of [root, document]) target?.removeEventListener?.('pointerdown', outside, true); window.removeEventListener?.('blur', blur); } };
  };
}
