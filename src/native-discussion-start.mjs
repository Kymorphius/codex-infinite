// The "新建讨论" flows behind the 讨论 button. One conversation of each kind takes part; which of
// them already exists depends on where the person is:
//   editor  — the native new-chat page: both are created, the composer's text is the topic;
//   current — an existing conversation: it is one side, the other side is created.
// A GPT conversation only exists once its first message is sent through the native app, so the
// GPT side is always created (or messaged) here; the host pairs them and sends the rest.
export function createNativeDiscussionStarter({ documentRef, api, notify, close, createThreadStarter }) {
  const NAME = { claude: 'Claude', gpt: 'GPT' };
  const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const composerText = (editor) => String(editor?.innerText || editor?.textContent || '').trim();
  let starting = false;

  // `editor` is emptied for the native handoff and its text put back if the native send fails
  // before anything was submitted. GPT is created first (the risky native step, so a failure
  // leaves nothing behind), then Claude.
  return async function startNew({ first, topic, project, editor = null, current = null }) {
    if (starting) return;
    const text = String(topic || '').trim();
    if (!text) return notify(editor ? '请先在输入框里写下议题' : '请先写下议题');
    const directories = project?.sourceDirectories;
    if (!project) return notify(editor ? '这个新聊天不在任何项目里，请先选择项目' : '找不到当前会话所属项目，请先在项目中展开它');
    if (!Array.isArray(directories) || directories.length !== 1) return notify('新建讨论需要项目只有一个目录；这个项目有多个目录或找不到目录');
    const terminals = window.__cccTerminalConversations, role = current?.role || '';
    const newGpt = role !== 'gpt', newClaude = role !== 'claude';
    if (role === 'claude' && terminals?.records?.().find((item) => item.id === current.tab.id)?.cwd !== directories[0]) return notify('本会话的目录不是项目的目录，无法在项目里新建对方会话');
    if ((newGpt && (typeof createThreadStarter !== 'function' || (!editor && !window.__cccProjectSearchActions?.create))) || (newClaude && !terminals?.createRecord)) return notify('原生新建入口尚未就绪');
    starting = true; close();
    let created = '', emptied = false;
    try {
      const prepared = await api().request('prepare', { first, topic: text });
      notify('正在创建讨论会话…');
      let gptId = role === 'gpt' ? current.tab.id : null, claude = null, claudeId = role === 'claude' ? current.tab.id : null;
      if (newGpt) {
        if (editor) {
          editor.focus(); documentRef.execCommand('selectAll'); documentRef.execCommand('delete');
          await pause(0);
          if (composerText(editor)) throw Error('输入框未能清空，议题保留在输入框里，请检查后重试');
          emptied = true;
        } else if (!(await window.__cccProjectSearchActions.create(project))) return;
        const starter = createThreadStarter();
        let failure = null;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          try { starter.preflight(); failure = null; break; } catch (error) { failure = error; if (/已有内容/.test(error.message || '')) break; await pause(100); }
        }
        if (failure) throw failure;
        try { gptId = await starter(prepared.gptText); }
        catch (error) {
          if (emptied && error?.nativeNotSubmitted) { editor.focus(); documentRef.execCommand('insertText', false, text); }
          throw error;
        }
        created = 'GPT 会话';
      }
      if (newClaude) {
        claude = await terminals.createRecord(project, directories[0], 'claude', { open: false });
        claudeId = claude.id; created = 'Claude 会话';
      }
      const result = await api().request('begin', { first, topic: text, claudeConversationId: claudeId, gptConversationId: gptId, sendGpt: role === 'gpt' });
      // Leave the person with whoever answers first (a GPT that answers first is already on screen,
      // or was never left).
      if (first === 'claude') {
        const record = claude || terminals?.records?.().find((item) => item.id === claudeId);
        if (record) window.__codexControlConsoleOpenTerminalConversation?.(record);
      }
      notify(result.deliveryError ? '已配对，但开场消息没有全部送达：' + result.deliveryError + '。请手动把议题发给对方' : '已新建讨论：' + NAME[first] + ' 先答，答完可用「讨论」转发给对方');
    } catch (error) {
      notify((created ? '已创建 ' + created + '，但后续步骤失败：' : '新建讨论失败：') + String(error?.message || error) + (created ? '。可用「与已有会话配对」补上' : ''));
    } finally { starting = false; }
  };
}
