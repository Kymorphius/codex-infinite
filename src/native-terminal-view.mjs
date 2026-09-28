export function installNativeTerminalView(createSession, statusText, css) {
  window.__cccOpenNativeTerminal = (record, host) => {
    window.__cccNativeTerminalView?.dispose();
    // Resolve the native client on use: it is replaced when the runtime is reinstalled.
    const client = () => window.__cccTerminalNative;
    const api = { request: (operation, input) => client().request(operation, input), socketClass: id => client().socketClass(id) };
    if (!host || !client()) return false;
    let view = null, disposed = false, generation = 0, busy = false, notice = '', last = null, armed = null, autoOpen = true, starting = false;
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
    const output = el('div', 'output'), composer = el('div', 'composer'), choiceDock = el('section', 'choice-dock');
    choiceDock.hidden = true; choiceDock.setAttribute('aria-label', 'Claude 当前选择');
    const choiceTitle = el('strong', 'choice-title'), choicePreview = el('pre', 'choice-preview'), choiceList = el('div', 'choice-list'), choiceActions = el('div', 'choice-actions');
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
    choiceActions.append(keyButton('pill', '↑ 上一项', 'up'), keyButton('pill', '↓ 下一项', 'down'), keyButton('pill', '空格选中', 'space'), keyButton('pill', '确认当前项', 'enter'), keyButton('pill', '取消', 'escape'));
    choiceDock.append(choiceTitle, choicePreview, choiceList, choiceActions);
    const keys = el('details', 'keys'), more = el('summary', 'pill', '更多按键'), menu = el('div', 'menu'), grid = el('div', 'grid');
    for (const [label, key] of [['Enter', 'enter'], ['↑', 'up'], ['↓', 'down'], ['Esc', 'escape'], ['Tab', 'tab'], ['Ctrl+D', 'eof']]) grid.append(keyButton('', label, key));
    const paste = el('button', 'paste', '仅粘贴，不按 Enter'); paste.type = 'button'; inputs.push(paste); paste.onclick = () => { keys.open = false; void submit(false); };
    more.insertAdjacentHTML?.('beforeend', '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 6.5 5 3.5l3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>');
    menu.append(el('span', '', '直接发送到终端'), grid, paste); keys.append(more, menu);
    footer.append(keyButton('pill', '打断', 'interrupt', '⌃C'), keyButton('pill', 'Esc', 'escape'), keys, status, send);
    const split = window.__cccCreateNativeTerminalSplit?.({ record, bar, output, api });
    const redraw = el('button', 'redraw', '重绘'); redraw.type = 'button'; redraw.title = '重新连接终端显示，不结束会话';
    redraw.onclick = () => view?.reconnect(); if (record.kind === 'claude') bar.append(redraw);
    composer.append(draft, footer); layout.append(bar, split?.element || output, choiceDock, composer); shadow.append(style, layout); host.append(root);
    // The native header keeps showing the last native conversation's name. Put this
    // conversation's title bar in that slot (trailing native actions stay) and fall back
    // to the in-view bar when the header is absent. React may remount the header, so re-attach.
    // The native toolbar disables pointer events and re-enables them per control; so do we.
    const titleHost = el('div'); titleHost.setAttribute('data-ccc-terminal-titlebar-content', '');
    titleHost.style.cssText = 'display:flex;flex:1;min-width:0;height:100%;align-items:center';
    const titleShadow = titleHost.attachShadow({ mode: 'open' }), titleStyle = el('style');
    titleStyle.textContent = css + ':host .bar{border:0;padding:0 6px;min-height:0;height:100%;width:100%}.bar button{-webkit-app-region:no-drag;app-region:no-drag;pointer-events:auto}.bar strong,.cwd{pointer-events:auto}';
    titleShadow.append(titleStyle);
    let headerStyle = document.getElementById('ccc-terminal-titlebar-style');
    if (!headerStyle) { headerStyle = el('style'); headerStyle.id = 'ccc-terminal-titlebar-style'; document.head.append(headerStyle); }
    headerStyle.textContent = 'html[data-ccc-terminal-titlebar] [data-app-shell-header-toolbar]>:has([data-app-shell-titlebar-content]){display:none!important}';
    let placing = false;
    function placeTitle() {
      placing = false; if (disposed) return;
      const toolbar = document.querySelector('[data-app-shell-focus-area="main"] [data-app-shell-header-toolbar]');
      if (!toolbar) { if (bar.parentNode !== layout) layout.prepend(bar); titleHost.remove(); document.documentElement.removeAttribute('data-ccc-terminal-titlebar'); return; }
      if (bar.parentNode !== titleShadow) titleShadow.append(bar);
      if (titleHost.parentNode !== toolbar) toolbar.prepend(titleHost);
      document.documentElement.setAttribute('data-ccc-terminal-titlebar', '');
    }
    const headerObserver = new MutationObserver(() => { if (!placing && !disposed) { placing = true; requestAnimationFrame(placeTitle); } });
    headerObserver.observe(document.body, { childList: true, subtree: true });
    placeTitle();
    // The shared 消息搜索 / 最近会话 / 最近发送 bar anchors to this composer (see state.composer).
    const relayout = () => { if (!disposed) window.__codexControlConsoleConversationTabs?.relayout?.(); };
    const composerObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
    composerObserver?.observe(composer);
    // Keyboard can still toggle a <details>; refuse while input is unavailable.
    more.onclick = event => { if (keys.hasAttribute?.('data-disabled')) event.preventDefault(); };
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
    // Takeover ends the other window's Claude, so it needs a second click within 4s.
    // Background-held sessions are opened (attached, shared); only a terminal window's hold needs takeover.
    const needsTakeover = () => Boolean(record.occupiedElsewhere) && record.occupiedBy !== 'background';
    function disarm() { if (armed) clearTimeout(armed); armed = null; launch.removeAttribute('data-armed'); launch.textContent = needsTakeover() ? '强制接管' : record.occupiedBy === 'background' ? '在此打开' : '启动会话'; }
    // Opening a conversation opens it: resume it, or attach to its Claude background job, once
    // per view. A takeover (ends another window), a start error, a Codex turn in progress or a
    // session that exited while shown keep the explicit button instead.
    const canAutoOpen = () => autoOpen && !record.runtimeSummary && record.status !== 'running' && !record.archived
      && !record.runtimeError && !needsTakeover();
    // Stopped here: startable, or read-only (with takeover) while another Claude window holds the session.
    function showStopped() {
      if (canAutoOpen()) { autoOpen = false; launch.hidden = true; void startHere(false); return; }
      if (starting) { launch.hidden = true; return; }
      launch.hidden = record.status === 'running'; if (!armed) disarm();
      launch.title = needsTakeover() ? '结束其他 Claude 窗口中的这个会话，并在这里继续' : record.occupiedBy === 'background' ? '连接到正在 Claude 后台运行的这个会话，不会停止它' : '';
      if (record.occupiedBy === 'background') setStatus('正在 Claude 后台运行 · 可在此打开', 'held');
      else if (record.occupiedElsewhere) setStatus('正在其他 Claude 窗口中运行 · 此处只读', 'held');
      else setStatus(record.runtimeError || '会话已停止，点击右上角启动', record.runtimeError ? 'bad' : 'idle');
    }
    function fit() { draft.style.height = 'auto'; if (draft.scrollHeight) draft.style.height = Math.min(draft.scrollHeight, 200) + 'px'; }
    function sync(state = view?.snapshot()) {
      const canInput = Boolean(state?.canInput) && !busy;
      send.disabled = !canInput || !draft.value; send.setAttribute('data-sending', String(busy));
      for (const button of inputs) button.disabled = !canInput;
      keys.toggleAttribute?.('data-disabled', !canInput); if (!canInput) keys.open = false;
      more.tabIndex = canInput ? 0 : -1; more.setAttribute('aria-disabled', String(!canInput));
      const prompt = canInput && record.kind === 'claude' ? state?.choicePrompt : null;
      choiceDock.hidden = !prompt;
      if (prompt) {
        choiceTitle.textContent = prompt.question;
        choicePreview.hidden = !prompt.preview;
        choicePreview.textContent = prompt.preview || '';
        const rows = prompt.options.map((option, index) => {
          const row = el('div', 'choice-option', `${option.number}. ${option.label}`);
          row.setAttribute('aria-current', String(index === prompt.selected));
          return row;
        });
        choiceList.replaceChildren(...rows);
      } else { choicePreview.hidden = true; choicePreview.textContent = ''; choiceList.replaceChildren(); }
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
      record = value; showRecord(); disarm();
      view?.dispose(); view = null; last = null; notice = ''; output.replaceChildren(); sync(null);
      if (!record.runtimeSummary) return showStopped();
      launch.hidden = record.status === 'running';
      const terminalHost = el('div'); terminalHost.style.cssText = 'width:100%;height:100%'; output.append(terminalHost);
      view = createSession(record.runtimeSummary, { host: terminalHost,
        WebSocketCtor: api.socketClass(record.id), locationRef: { href: 'http://127.0.0.1/', protocol: 'http:' },
        onUiCommand: action => {
          if (disposed || record.kind !== 'claude') return;
          if (action === 'redraw') Promise.resolve().then(() => { if (!disposed) view?.reconnect(); });
          else if (action.startsWith('split=')) split?.command(action.slice('split='.length));
        },
        onChange: state => {
          if (disposed) return; last = state; launch.hidden = state.session.status === 'running'; sync(state); renderStatus(state);
        }
      });
      view.activate();
    }
    launch.onclick = async () => {
      const takeover = needsTakeover();
      if (takeover && !armed) { launch.textContent = '确认接管？将结束其他窗口'; launch.setAttribute('data-armed', ''); armed = setTimeout(disarm, 4000); return; }
      disarm(); autoOpen = false; await startHere(takeover);
    };
    async function startHere(takeover) {
      const token = ++generation; launch.disabled = true; starting = true;
      setStatus(takeover ? '正在结束其他窗口并接管…' : record.occupiedBy === 'background' ? '正在连接…' : '正在启动…', 'wait');
      try { const result = await api.request('start', takeover ? { id: record.id, takeover: true } : { id: record.id }); if (!disposed && token === generation) { window.__cccTerminalConversations?.accept(result.conversation); mount(result.conversation); } }
      catch (error) { if (!disposed) { launch.hidden = false; disarm(); setNotice(error.message); } }
      finally { starting = false; if (!disposed) launch.disabled = false; }
    }
    const state = { id: record.id, composer, update(value) { if (disposed || value.id !== record.id) return; if (value.archived) state.dispose(); else if (value.runtimeSessionId !== record.runtimeSessionId) {
        // Lost without an exit shown here (backend restart, disconnect): open it again once.
        if (record.runtimeSessionId && !value.runtimeSessionId && last?.session?.status !== 'exited') autoOpen = true;
        mount(value); } else { record = value; showRecord(); if (!view) showStopped(); } },
      // Reconnect the shown terminal through a rebuilt native client.
      remount() { if (!disposed) mount(record); },
      dispose() { if (disposed) return; disposed = true; generation++; if (armed) clearTimeout(armed); view?.dispose(); split?.dispose(); root.remove(); headerObserver.disconnect(); composerObserver?.disconnect(); titleHost.remove(); document.documentElement.removeAttribute('data-ccc-terminal-titlebar'); for (const [node, display] of saved) node.style.display = display; if (surface) surface.style.setProperty('padding-top', inset[0], inset[1]); if (window.__cccNativeTerminalView === state) window.__cccNativeTerminalView = null; window.__codexControlConsoleConversationTabs?.relayout?.(); }
    };
    window.__cccNativeTerminalView = state; mount(record); fit(); sync(); requestAnimationFrame(relayout); return true;
  };
}
