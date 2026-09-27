export function installNativeTerminalView(createSession, statusText, css) {
  window.__cccOpenNativeTerminal = (record, host) => {
    window.__cccNativeTerminalView?.dispose();
    const api = window.__cccTerminalNative;
    if (!host || !api) return false;
    let view = null, disposed = false, generation = 0, busy = false, notice = '', last = null;
    const saved = [...host.children].map(node => [node, node.style.display]);
    for (const [node] of saved) node.style.display = 'none';
    // The page-tab inset reserves an empty row above native pages; the terminal reclaims it.
    const surface = host.closest?.('main[class*="_MainContentSurface_"]'), inset = surface && [surface.style.getPropertyValue('padding-top'), surface.style.getPropertyPriority('padding-top')];
    surface?.style.setProperty('padding-top', '0px', 'important');
    const el = (tag, className = '', text = '') => { const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node; };
    const root = el('section'); root.setAttribute('data-codex-control-console-workspace', '');
    root.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;width:100%;height:100%';
    const shadow = root.attachShadow({ mode: 'open' }); shadow.addEventListener('keydown', event => event.stopPropagation());
    const style = el('style'); style.textContent = css;
    const layout = el('div', 'layout'), bar = el('header', 'bar'), title = el('strong'), chip = el('span', 'chip'), cwd = el('span', 'cwd');
    const launch = el('button', 'launch', '启动会话'); bar.append(title, chip, cwd, launch);
    const output = el('div', 'output'), composer = el('div', 'composer'), hint = el('div', 'hint', 'Enter 发送 · Shift+Enter 换行 · 点击上方终端可直接键入');
    const draft = el('textarea'); draft.rows = 1; draft.placeholder = '发送到终端…'; draft.setAttribute('aria-label', '终端会话输入');
    const footer = el('footer'), status = el('span', 'status'), send = el('button', 'send');
    status.setAttribute('role', 'status'); send.setAttribute('aria-label', '发送到终端'); send.disabled = true;
    send.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const inputs = [];
    function keyButton(className, label, key, shortcut) {
      const button = el('button', className, label); button.type = 'button'; inputs.push(button);
      if (shortcut) { const hintKey = el('kbd', '', shortcut); button.append(hintKey); }
      button.onclick = () => { keys.open = false; const result = view?.sendKey(key); if (result && !result.ok) setNotice(result.message); else { clearNotice(); view?.activate(); } };
      return button;
    }
    const keys = el('details', 'keys'), more = el('summary', 'pill', '更多按键'), menu = el('div', 'menu'), grid = el('div', 'grid');
    for (const [label, key] of [['Enter', 'enter'], ['↑', 'up'], ['↓', 'down'], ['Esc', 'escape'], ['Tab', 'tab'], ['Ctrl+D', 'eof']]) grid.append(keyButton('', label, key));
    const paste = el('button', 'paste', '仅粘贴，不按 Enter'); paste.type = 'button'; inputs.push(paste); paste.onclick = () => { keys.open = false; void submit(false); };
    more.insertAdjacentHTML?.('beforeend', '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
    menu.append(el('span', '', '直接发送到终端'), grid, paste); keys.append(more, menu);
    footer.append(keyButton('pill', '打断', 'interrupt', '⌃C'), keyButton('pill', 'Esc', 'escape'), keys, status, send);
    composer.append(draft, footer); layout.append(bar, output, composer, hint); shadow.append(style, layout); host.append(root);
    shadow.addEventListener('pointerdown', event => { if (keys.open && !event.composedPath?.().includes(keys)) keys.open = false; });
    function setStatus(text, tone) { status.textContent = text; status.title = text; status.setAttribute('data-tone', tone); }
    function setNotice(text) { notice = text; setStatus(text, 'bad'); }
    function clearNotice() { notice = ''; if (last) renderStatus(last); }
    function renderStatus(state) {
      if (state.error || notice) return setStatus(state.error || notice, 'bad');
      const { connection } = state, exited = state.session.status === 'exited';
      setStatus(statusText(state.session, connection), exited ? 'idle' : connection === 'connected' ? 'ok' : /connecting|retrying/u.test(connection) ? 'wait' : 'bad');
    }
    function showRecord() {
      title.textContent = record.title; title.title = record.title;
      chip.textContent = record.kind === 'shell' ? 'Shell' : 'Claude CLI'; chip.setAttribute('data-kind', record.kind === 'shell' ? 'shell' : 'claude');
      chip.hidden = chip.textContent === record.title;
      cwd.textContent = (record.cwd || '').replace(/^\/Users\/[^/]+(?=\/|$)/u, '~'); cwd.title = record.cwd || '';
    }
    function fit() { draft.style.height = 'auto'; if (draft.scrollHeight) draft.style.height = Math.min(draft.scrollHeight, 200) + 'px'; }
    function sync(state = view?.snapshot()) {
      const canInput = Boolean(state?.canInput) && !busy;
      send.disabled = !canInput || !draft.value; send.setAttribute('data-sending', String(busy));
      for (const button of inputs) button.disabled = !canInput;
    }
    const draftKey = 'terminal-draft:' + record.id;
    try { draft.value = sessionStorage.getItem(draftKey) || ''; } catch {}
    draft.oninput = () => { try { sessionStorage.setItem(draftKey, draft.value); } catch {} fit(); sync(); };
    async function submit(enter = true) {
      if (busy || !view || !draft.value || !view.snapshot().canInput) return;
      busy = true; clearNotice(); const text = draft.value; sync();
      const result = await view.pasteText(text, { submit: enter }); busy = false;
      if (disposed) return;
      if (result.ok && draft.value === text) { draft.value = ''; draft.oninput(); }
      else if (!result.ok) setNotice(result.message);
      sync();
    }
    send.onclick = () => submit(); draft.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit(); }
      event.stopPropagation();
    };
    function mount(value) {
      record = value; showRecord(); launch.hidden = record.status === 'running';
      view?.dispose(); view = null; last = null; notice = ''; output.replaceChildren(); sync(null);
      if (!record.runtimeSummary) { setStatus(record.runtimeError || '会话已停止，点击右上角启动', record.runtimeError ? 'bad' : 'idle'); return; }
      const terminalHost = el('div'); terminalHost.style.cssText = 'width:100%;height:100%'; output.append(terminalHost);
      view = createSession(record.runtimeSummary, { host: terminalHost,
        WebSocketCtor: api.socketClass(record.id), locationRef: { href: 'http://127.0.0.1/', protocol: 'http:' },
        onChange: state => {
          if (disposed) return; last = state; launch.hidden = state.session.status === 'running'; sync(state); renderStatus(state);
        }
      });
      view.activate();
    }
    launch.onclick = async () => {
      const token = ++generation; launch.disabled = true; setStatus('正在启动…', 'wait');
      try { const result = await api.request('start', { id: record.id }); if (!disposed && token === generation) { window.__cccTerminalConversations?.accept(result.conversation); mount(result.conversation); } }
      catch (error) { if (!disposed) setNotice(error.message); }
      finally { if (!disposed) launch.disabled = false; }
    };
    const state = { id: record.id, update(value) { if (disposed || value.id !== record.id) return; if (value.archived) state.dispose(); else if (value.runtimeSessionId !== record.runtimeSessionId) mount(value); else { record = value; showRecord(); } },
      dispose() { if (disposed) return; disposed = true; generation++; view?.dispose(); root.remove(); for (const [node, display] of saved) node.style.display = display; if (surface) surface.style.setProperty('padding-top', inset[0], inset[1]); if (window.__cccNativeTerminalView === state) window.__cccNativeTerminalView = null; }
    };
    window.__cccNativeTerminalView = state; mount(record); fit(); sync(); return true;
  };
}
