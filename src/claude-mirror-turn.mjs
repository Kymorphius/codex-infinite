import { spawn as nodeSpawn } from 'node:child_process';
import path from 'node:path';
import { terminalError } from './terminal-contract.mjs';
import { terminalEnvironment } from './terminal-process.mjs';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// A message sent from the mirror runs as one `claude -p --resume` that exits when the reply is done,
// so no process keeps holding the session and Codex can use it between turns. Per conversation the
// turns run one at a time; a turn first waits for a one-shot holder (usually Router's Codex turn) and
// refuses while an interactive Claude holds the session. State is kept for the mirror to show.
export function createClaudeMirrorTurns({ userHome, holders, spawn = nodeSpawn, waitMs = 900000, pollMs = 1000,
  shell = path.isAbsolute(process.env.SHELL || '') ? process.env.SHELL : '/bin/zsh', now = () => Date.now() } = {}) {
  const states = new Map(), queues = new Map();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function free(ids) {
    const deadline = now() + waitMs;
    for (;;) {
      const found = await holders(ids);
      const interactive = found.find(item => !item.codexTurn);
      if (interactive) throw terminalError(409, `会话正在交互模式或其他 Claude 窗口中运行（进程 ${interactive.pid}），退出后再发送`);
      if (!found.length) return;
      if (now() >= deadline) throw terminalError(409, 'Codex 这一轮还没结束，请稍后再发送');
      await sleep(pollMs);
    }
  }
  function run({ target, cwd, text }) {
    return new Promise((resolve, reject) => {
      const child = spawn(shell, ['-lc', `command claude -p --resume ${target} --permission-mode bypassPermissions`],
        { cwd, env: terminalEnvironment({ userHome, shell }), stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(terminalError(502, `Claude 未完成这条消息${stderr.trim() ? `：${stderr.trim().split('\n').at(-1).slice(0, 300)}` : ''}`)));
      child.stdin.end(text);
    });
  }
  return {
    state: id => states.get(id) || null,
    // Returns once the turn is queued; the mirror reads progress and the reply from the transcript.
    send({ id, ids, target, cwd, text }) {
      if (!SESSION_ID.test(target || '')) throw terminalError(400, 'Claude 会话标识无效');
      if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw terminalError(400, '消息为空或过长');
      const previous = queues.get(id) || Promise.resolve();
      states.set(id, { state: 'waiting', since: now() });
      const turn = previous.catch(() => {}).then(async () => {
        states.set(id, { state: 'waiting', since: now() });
        await free(ids);
        states.set(id, { state: 'running', since: now() });
        await run({ target, cwd, text });
        states.delete(id);
      }).catch(error => { states.set(id, { state: 'failed', error: String(error.message || 'Claude 未完成这条消息'), since: now() }); });
      queues.set(id, turn);
      turn.finally(() => { if (queues.get(id) === turn) queues.delete(id); });
      return states.get(id);
    },
  };
}
