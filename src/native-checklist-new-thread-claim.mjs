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
  const start = async input => {
    let submitted = false;
    try {
    const parts = Array.isArray(input) ? input : [{ type: 'text', text: String(input || '') }];
    const text = parts.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
    if (parts.some(part => part?.type === 'heldImage')) throw new Error('含图片的任务请领取到现有会话待办；新建会话图片发送暂不支持');
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
    submitted = true; send.click();
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
    } catch (error) { if (!submitted) error.nativeNotSubmitted = true; throw error; }
  };
  start.preflight = () => {
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    if (!editor?.closest('[data-composer-surface-variant]') || readMountedId()) throw new Error('请从新建任务页领取');
    if ((editor.innerText || editor.textContent || '').trim()) throw new Error('输入框已有内容，请先处理原有草稿');
  };
  return start;
}

export function createNativeChecklistNewThreadClaim({ start, readTask, enqueue, report, showFailure, prepare, release, storage }) {
  const inFlight = new Set();
  const controller = {
    async claim(id, readEdited, lockHeld = false) {
      if (inFlight.has(id)) return;
      if (!lockHeld && typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('ccc-task-delivery:' + id, { ifAvailable: true }, lock => lock && controller.claim(id, readEdited, true));
      let edited = readEdited();
      if (!edited || edited.done || edited.executionState === 'delivered' || edited.assignedThreadId) return;
      inFlight.add(id);
      report('正在用任务内容创建新会话…');
      const receiptKey = 'ccc.checklist.new-thread.v1:' + id;
      let receipt;
      try {
        if (edited.input?.some(part => part.type === 'heldImage')) throw new Error('带图任务请选择已有会话');
        receipt = storage ? JSON.parse(storage.getItem(receiptKey) || 'null') : null;
        if (receipt?.phase === 'releasing') {
          if (edited.sourceConnected && !edited.deliveryReservation && edited.expectedRevision && ![receipt.expectedRevision, receipt.sourceRevisionBefore].includes(edited.expectedRevision)) { storage.removeItem(receiptKey); receipt = null; }
          else if (edited.sourceConnected && edited.deliveryReservation?.token === receipt.reservationToken && release) { await release(id, receipt, receipt.releaseRequestId); storage.removeItem(receiptKey); report('任务预占已解除，可以重新领取'); return; }
          else throw new Error('尚未发送消息，任务预占解除结果待核对');
        }
        if (receipt && (receipt.phase !== 'verifying' || !lockHeld)) throw new Error('上次领取结果待核对，已阻止重复发送；请先查看最近会话');
        const ownsReservation = receipt && edited.deliveryReservation?.requestId === receipt.requestId;
        if (edited.sourceConnected === false || (edited.readOnly && !ownsReservation)) throw new Error('任务来源未连接或交付待核对');
        if (receipt?.text) edited = { ...edited, text: receipt.text, ...(receipt.input ? { input: receipt.input } : {}) };
        if (edited.sourceRef && (!prepare || !storage)) throw new Error('任务来源核对尚未就绪，请刷新后领取');
        start.preflight?.();
        const requestId = receipt?.requestId || crypto.randomUUID();
        receipt ||= { phase: 'verifying', requestId, expectedRevision: edited.expectedRevision, sourceRevisionBefore: edited.expectedRevision, text: edited.text, ...(edited.input ? { input: edited.input } : {}) };
        storage?.setItem(receiptKey, JSON.stringify(receipt));
        const reserved = ownsReservation ? { revision: edited.expectedRevision, deliveryReservation: edited.deliveryReservation } : prepare ? await prepare(edited, requestId) : null;
        if (edited.sourceRef && !reserved?.deliveryReservation?.token) throw new Error('来源设备未确认任务预占，未发送消息');
        const reservation = reserved ? { expectedRevision: reserved.revision, reservationToken: reserved.deliveryReservation.token } : {};
        Object.assign(receipt, reservation, { phase: 'submitting' }); storage?.setItem(receiptKey, JSON.stringify(receipt));
        const threadId = await start(edited.input || edited.text);
        receipt.phase = 'created'; receipt.threadId = threadId; storage?.setItem(receiptKey, JSON.stringify(receipt));
        const current = readTask(id);
        if (!current || current.done || current.assignedThreadId) {
          report('会话已创建，但任务状态已变化；请检查任务清单');
          return;
        }
        const saved = enqueue({ ...current, ...reservation, text: edited.text, ...(edited.input ? { input: edited.input } : {}), done: false, executionState: 'delivered', assignedThreadId: threadId });
        report(saved ? '会话已创建，正在保存任务状态…' : '会话已创建，但任务状态未保存；请检查任务清单');
      } catch (error) {
        if (receipt?.reservationToken && error.nativeNotSubmitted && release) {
          receipt.phase = 'releasing'; receipt.releaseRequestId = crypto.randomUUID(); storage?.setItem(receiptKey, JSON.stringify(receipt));
          try { await release(id, receipt, receipt.releaseRequestId); storage?.removeItem(receiptKey); } catch { report('尚未发送消息，任务预占解除结果待核对'); showFailure(); return; }
        } else if (receipt?.phase === 'verifying' && ['REVISION_CONFLICT', 'TASK_NOT_FOUND', 'TARGET_MISMATCH', 'TASK_NOT_PENDING', 'DELIVERY_RESERVED'].includes(error.code)) storage?.removeItem(receiptKey);
        report(String(error?.message || '无法新建会话')); showFailure();
      }
      finally { inFlight.delete(id); }
    }
  };
  return controller;
}
