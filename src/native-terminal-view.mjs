export function installNativeTerminalView(createSession, statusText, css) {
  window.__cccOpenNativeTerminal = (record, host) => {
    window.__cccNativeTerminalView?.dispose();
    const api = window.__cccTerminalNative;
    if (!host || !api) return false;
    let view = null, disposed = false, generation = 0, busy = false;
    const saved = [...host.children].map(node => [node, node.style.display]);
    for (const [node] of saved) node.style.display = 'none';
    const root = document.createElement('section'); root.setAttribute('data-codex-control-console-workspace', '');
    root.style.cssText = 'display:flex;flex:1;min-width:0;min-height:0;width:100%;height:100%';
    const shadow = root.attachShadow({ mode: 'open' }); shadow.addEventListener('keydown', event => event.stopPropagation());
    const style = document.createElement('style');
    style.textContent = css + `
      :host{color:#e4e4e7;font:14px system-ui}*{box-sizing:border-box}
      .layout{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;background:#171719;padding:16px 22px;gap:12px}
      header{display:flex;align-items:center;gap:12px}header strong{flex:1}button{border:1px solid #6665;border-radius:18px;padding:7px 13px;background:#333;color:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}
      .output{flex:1;min-height:0;overflow:hidden}.composer{background:#303030;border:1px solid #ffffff14;border-radius:24px;padding:16px;display:grid;gap:12px}
      textarea{resize:none;width:100%;min-height:60px;border:0;outline:0;background:transparent;color:inherit;font:16px system-ui}footer{display:flex;align-items:center;gap:8px}.status{flex:1;font-size:12px;color:#aaa}.send{background:#eee;color:#111;font-size:20px;width:40px;height:40px;padding:0;border-radius:50%}
    `;
    const layout = document.createElement('div'); layout.className = 'layout';
    const header = document.createElement('header'), title = document.createElement('strong'), launch = document.createElement('button');
    title.textContent = record.title; launch.textContent = '启动会话'; header.append(title, launch);
    const output = document.createElement('div'); output.className = 'output';
    const composer = document.createElement('div'); composer.className = 'composer';
    const draft = document.createElement('textarea'); draft.placeholder = '发送到终端…'; draft.setAttribute('aria-label', '终端会话输入');
    const footer = document.createElement('footer'), status = document.createElement('span'), send = document.createElement('button');
    status.className = 'status'; send.className = 'send'; send.textContent = '↑'; send.setAttribute('aria-label', '发送到终端'); send.disabled = true;
    for (const [label, key] of [['中断', 'interrupt'], ['Esc', 'escape'], ['Tab', 'tab']]) {
      const button = document.createElement('button'); button.textContent = label; button.onclick = () => { const result = view?.sendKey(key); if (result && !result.ok) status.textContent = result.message; }; footer.append(button);
    }
    footer.append(status, send); composer.append(draft, footer); layout.append(header, output, composer); shadow.append(style, layout); host.append(root);
    const draftKey = 'terminal-draft:' + record.id;
    try { draft.value = sessionStorage.getItem(draftKey) || ''; } catch {}
    draft.oninput = () => { try { sessionStorage.setItem(draftKey, draft.value); } catch {} };
    async function submit() {
      if (busy || !view || !draft.value || send.disabled) return;
      busy = true; const text = draft.value; send.disabled = true;
      const result = await view.pasteText(text, { submit: true }); busy = false;
      if (disposed) return;
      if (result.ok && draft.value === text) { draft.value = ''; draft.oninput(); }
      else if (!result.ok) status.textContent = result.message;
      send.disabled = !view.snapshot().canInput;
    }
    send.onclick = submit; draft.onkeydown = event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); void submit(); }
      event.stopPropagation();
    };
    function mount(value) {
      record = value; title.textContent = record.title; launch.hidden = record.status === 'running';
      view?.dispose(); view = null; output.replaceChildren();
      if (!record.runtimeSummary) { status.textContent = record.runtimeError || '会话已停止，点击启动继续'; send.disabled = true; return; }
      const terminalHost = document.createElement('div'); terminalHost.style.cssText = 'width:100%;height:100%'; output.append(terminalHost);
      view = createSession(record.runtimeSummary, { host: terminalHost,
        WebSocketCtor: api.socketClass(record.id), locationRef: { href: 'http://127.0.0.1/', protocol: 'http:' },
        onChange: state => { if (disposed) return; status.textContent = state.error || statusText(state.session, state.connection); send.disabled = busy || !state.canInput; launch.hidden = state.session.status === 'running'; }
      });
      view.activate();
    }
    launch.onclick = async () => {
      const token = ++generation; launch.disabled = true;
      try { const result = await api.request('start', { id: record.id }); if (!disposed && token === generation) { window.__cccTerminalConversations?.accept(result.conversation); mount(result.conversation); } }
      catch (error) { if (!disposed) status.textContent = error.message; }
      finally { if (!disposed) launch.disabled = false; }
    };
    const state = { id: record.id, update(value) { if (disposed || value.id !== record.id) return; title.textContent = value.title; if (value.archived) state.dispose(); else if (value.runtimeSessionId !== record.runtimeSessionId) mount(value); else record = value; },
      dispose() { if (disposed) return; disposed = true; generation++; view?.dispose(); root.remove(); for (const [node, display] of saved) node.style.display = display; if (window.__cccNativeTerminalView === state) window.__cccNativeTerminalView = null; }
    };
    window.__cccNativeTerminalView = state; mount(record); return true;
  };
}
