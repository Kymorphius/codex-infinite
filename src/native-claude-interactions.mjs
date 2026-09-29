import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';

export function buildNativeClaudeInteractions(binding) {
  return `(${install.toString()})(${JSON.stringify(binding)}, ${readNativeComposerThreadId.toString()})`;
}
function install(binding, readThread) {
  if (window.__cccClaudeInteractionsInstalled) return;
  let disposed = false;
  const pending = new Map(); let sequence = 0, current = '', shown = '', panel, polling = false;
  window.__cccClaudeInteractionReceive = value => {
    const waiter = pending.get(value?.id); if (!waiter) return;
    pending.delete(value.id); clearTimeout(waiter.timer);
    if (value.error) waiter.reject(Error(value.error)); else waiter.resolve(value.result);
  };
  function request(operation, threadId, answer) {
    return new Promise((resolve, reject) => {
      const id = 'ci-' + (++sequence);
      const timer = setTimeout(() => { pending.delete(id); reject(Error('Claude 交互连接超时')); }, 6000);
      pending.set(id, { resolve, reject, timer });
      try { window[binding](JSON.stringify({ id, operation, threadId, answer })); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  function clear() { panel?.remove(); panel = null; shown = ''; }
  function element(tag, text, parent) {
    const node = document.createElement(tag); if (text) node.textContent = text;
    parent?.append(node); return node;
  }
  function render(item, threadId, host) {
    clear(); shown = item.id;
    panel = element('section', '', host); panel.dataset.cccClaudeInteraction = item.id;
    panel.style.cssText = 'margin:8px 0;padding:14px;border:1px solid var(--border-default,#8886);border-radius:12px;background:var(--bg-primary,#242424);color:inherit;max-height:45vh;overflow:auto;font-size:13px';
    element('strong', item.kind === 'questions' ? 'Claude 等待你的选择' : 'Claude 请求确认 · ' + item.toolName, panel);
    const form = element('form', '', panel), answers = [];
    if (item.kind === 'questions') {
      for (const [index, q] of item.questions.entries()) {
        const group = element('fieldset', '', form); group.style.cssText = 'border:0;margin:10px 0;padding:0';
        element('legend', q.question, group);
        const controls = [];
        for (const option of q.options) {
          const label = element('label', '', group); label.style.cssText = 'display:block;margin:8px 0;cursor:pointer';
          const input = element('input', '', label); input.type = q.multiSelect ? 'checkbox' : 'radio'; input.name = `q${index}`; input.value = option.label;
          element('span', ' ' + option.label + (option.description ? ' — ' + option.description : ''), label); controls.push(input);
          if (option.preview) {
            const details = element('details', '', group); element('summary', '查看方案预览', details);
            element('pre', option.preview, details).style.cssText = 'white-space:pre-wrap;overflow:auto';
          }
        }
        const label = element('label', '其他回答 ', group), free = element('textarea', '', label);
        free.rows = 2; free.maxLength = 16000; free.placeholder = '输入你的回答'; free.style.cssText = 'display:block;width:100%;color:inherit;background:transparent;border:1px solid #8886;border-radius:6px';
        if (!q.multiSelect) {
          free.addEventListener('input', () => { if (free.value.trim()) controls.forEach(control => { control.checked = false; }); });
          controls.forEach(control => control.addEventListener('change', () => { free.value = ''; }));
        }
        answers.push(() => ({ selected: controls.filter(control => control.checked).map(control => control.value), text: free.value }));
      }
    } else {
      element('p', item.description, form);
      element('pre', item.input, form).style.cssText = 'white-space:pre-wrap;overflow:auto';
    }
    const error = element('p', '', form); error.setAttribute('role', 'status');
    const submit = element('button', item.kind === 'questions' ? '提交选择' : '允许这一次', form); submit.type = 'submit';
    const deny = element('button', item.kind === 'questions' ? '取消回答' : '拒绝', form); deny.type = 'button'; deny.style.marginLeft = '12px';
    async function send(decision) {
      if (window.__cccNativeTerminalView || readThread(document) !== threadId || shown !== item.id) { clear(); return; }
      const values = answers.map(answer => answer());
      if (decision === 'allow' && item.kind === 'questions' && values.some(answer => !answer.selected.length && !answer.text.trim())) {
        error.textContent = '请回答每个问题后提交'; return;
      }
      submit.disabled = deny.disabled = true;
      try { await request('answer', threadId, { id: item.id, decision, answers: values }); if (shown === item.id) clear(); }
      catch (failure) { error.textContent = failure.message; submit.disabled = deny.disabled = false; }
    }
    form.addEventListener('submit', event => { event.preventDefault(); void send('allow'); });
    deny.addEventListener('click', () => { void send('deny'); });
  }
  async function poll() {
    const threadId = readThread(document);
    if (disposed) return;
    if (current !== threadId) { clear(); current = threadId; }
    // A standalone terminal may cover the native workspace without changing its route.
    const terminal = window.__cccNativeTerminalView;
    if (!threadId || terminal) { clear(); return; }
    if (polling || typeof window[binding] !== 'function') return;
    polling = true;
    try {
      const value = await request('read', threadId);
      if (disposed || threadId !== readThread(document)) { clear(); return; }
      const item = value.requests[0];
      if (!item) { clear(); return; }
      if (shown === item.id && panel?.isConnected) return;
      const host = [...document.querySelectorAll('[data-above-composer-conversation-id]')].find(node =>
        node.getAttribute('data-above-composer-conversation-id').replace(/^local:/, '').toLowerCase() === threadId);
      if (host) render(item, threadId, host);
    } catch { clear(); }
    finally { polling = false; }
  }
  const timer = setInterval(() => { void poll(); }, 800);
  window.__cccClaudeInteractionsInstalled = { dispose() {
    disposed = true; clearInterval(timer); clear();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error('交互面板已关闭')); }
    pending.clear(); delete window.__cccClaudeInteractionReceive; delete window.__cccClaudeInteractionsInstalled;
  } };
  void poll();
}
