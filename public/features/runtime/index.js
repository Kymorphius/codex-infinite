export function confirmRestart(message, documentImpl = document) {
  return new Promise(resolve => {
    const dialog = documentImpl.createElement('dialog');
    dialog.style.cssText = 'max-width:420px;border:1px solid var(--native-ui-border);border-radius:12px;padding:24px;background:var(--native-ui-surface,#fff);color:var(--native-ui-text,#222)';
    const title = documentImpl.createElement('h2'); title.textContent = '重启控制台';
    const text = documentImpl.createElement('p'); text.textContent = message; text.style.whiteSpace = 'pre-line';
    const actions = documentImpl.createElement('div'); actions.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px';
    const cancel = documentImpl.createElement('button'), restart = documentImpl.createElement('button');
    cancel.type = restart.type = 'button'; cancel.className = restart.className = 'quiet-button';
    cancel.textContent = '取消'; restart.textContent = '重启';
    let done = false;
    const finish = value => { if (done) return; done = true; dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener('click', () => finish(false)); restart.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
    actions.append(cancel, restart); dialog.append(title, text, actions); documentImpl.body.append(dialog);
    try { dialog.showModal(); cancel.focus(); } catch { dialog.remove(); resolve(false); }
  });
}

export function installRestartButton({ button, showToast, fetchImpl = fetch, confirmImpl = confirmRestart,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), reload = () => location.reload() }) {
  if (!button) return;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    let accepted = false;
    try {
      if (!await confirmImpl('重启当前设备的控制台窗口和后台服务？\n正在执行的任务可能被中断。其他设备和原生 GPT 窗口不受影响。')) return;
      button.textContent = '重启中…';
      const response = await fetchImpl('/api/runtime/restart', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const result = await response.json();
      if (!response.ok || !result.instanceId) throw Error(result.message || '无法安排重启');
      accepted = true; showToast('正在重启，窗口将暂时关闭并自动恢复');
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await sleep(2000);
        try {
          const status = await fetchImpl('/api/runtime/status', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
          const current = await status.json();
          if (status.ok && current.instanceId && current.instanceId !== result.instanceId) { reload(); return; }
        } catch { /* temporary disconnect is expected */ }
      }
      throw Error('重启恢复超时，请重新打开控制台查看状态');
    } catch (error) { showToast(accepted ? error.message : '重启未完成：' + error.message); }
    finally { button.disabled = false; button.textContent = '重启'; }
  });
}
