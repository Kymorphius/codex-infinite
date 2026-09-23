// One-shot native composer handoff. The app owns thread creation and sending.
export function createNativeChecklistThreadStarter() {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const readMountedId = () => {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    let root = editor?.parentElement;
    while (root) {
      const raw = root.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
      if (uuid.test(raw)) return raw.toLowerCase();
      root = root.parentElement;
    }
    return null;
  };
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const requestThread = threadId => new Promise((resolve, reject) => {
    const bridge = window.electronBridge?.sendMessageFromView;
    if (typeof bridge !== 'function') { reject(new Error('原生会话核对服务尚未就绪')); return; }
    const id = 'ccc-claimed-first-message-' + crypto.randomUUID();
    const receive = event => {
      const data = event.data;
      if (data?.type !== 'mcp-response' || data?.hostId !== 'local' || data.message?.id !== id) return;
      cleanup();
      if (data.message.error) reject(new Error(data.message.error.message || '新会话核对失败'));
      else resolve(data.message.result);
    };
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', receive); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('新会话核对结果未确认')); }, 3000);
    window.addEventListener('message', receive);
    try { Promise.resolve(bridge.call(window.electronBridge, {
      type: 'mcp-request', hostId: 'local', retainResponse: true,
      request: { id, method: 'thread/read', params: { threadId, includeTurns: true } }
    })).catch(error => { cleanup(); reject(error); }); }
    catch (error) { cleanup(); reject(error); }
  });
  return async text => {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    const root = editor?.closest('[data-composer-surface-variant]');
    if (!root || readMountedId()) throw new Error('请从新建任务页领取');
    if ((editor.innerText || editor.textContent || '').trim()) throw new Error('输入框已有内容，请先处理原有草稿');
    document.querySelector('[data-ccc-checklist]')?.close();
    editor.focus();
    document.execCommand('insertText', false, text);
    await pause(0);
    if ((editor.innerText || editor.textContent || '').trim() !== text.trim()) throw new Error('输入框内容未能核对，请先检查草稿');
    const labels = ['发送', 'Send', '发送消息', 'Send message'];
    let send = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      send = [...root.querySelectorAll('button[aria-label]')].find(button => labels.includes(button.getAttribute('aria-label')) && !button.disabled);
      if (send) break;
      await pause(50);
    }
    if (!send || readMountedId()) throw new Error('原生发送按钮尚未就绪，内容已留在输入框，请检查后手动发送');
    if ((editor.innerText || editor.textContent || '').trim() !== text.trim()) throw new Error('输入框内容已变化，请检查后再发送');
    const requestedAt = Date.now();
    send.click();
    let threadId = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      threadId = readMountedId();
      if (threadId) break;
      await pause(100);
    }
    if (!threadId) throw new Error('已请求原生发送，但未确认新会话；请先检查最近会话，避免重复领取');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const result = await requestThread(threadId), thread = result?.thread;
        const first = thread?.turns?.[0]?.items?.find(item => item?.type === 'userMessage');
        const actual = first?.content?.filter(item => item?.type === 'text').map(item => item.text || '').join('\n').trim();
        if (thread?.id?.toLowerCase() === threadId && Number(thread.createdAt) * 1000 >= requestedAt - 10000 && actual === text.trim()) return threadId;
        if (actual && actual !== text.trim()) throw new Error('新会话首条消息与领取内容不符，请检查后手动处理任务');
      } catch (error) {
        if (/不符|服务尚未就绪/.test(error.message || '')) throw error;
      }
      await pause(250);
    }
    throw new Error('新会话已打开，但首条消息尚未核对；请先检查会话，避免重复领取');
  };
}

export function createNativeChecklistNewThreadClaim({ start, readTask, enqueue, report, showFailure }) {
  const inFlight = new Set();
  return {
    async claim(id, readEdited) {
      if (inFlight.has(id)) return;
      const edited = readEdited();
      if (!edited || edited.done || edited.assignedThreadId) return;
      inFlight.add(id);
      report('正在用任务内容创建新会话…');
      try {
        const threadId = await start(edited.text);
        const current = readTask(id);
        if (!current || current.done || current.assignedThreadId) {
          report('会话已创建，但任务状态已变化；请检查任务清单');
          return;
        }
        const requestId = enqueue({ ...current, text: edited.text, done: true, assignedThreadId: threadId });
        report(requestId ? '会话已创建，正在保存任务状态…' : '会话已创建，但任务状态未保存；请检查任务清单');
      } catch (error) { report(String(error?.message || '无法新建会话')); showFailure(); }
      finally { inFlight.delete(id); }
    }
  };
}
