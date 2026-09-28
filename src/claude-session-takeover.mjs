import { execFile } from 'node:child_process';
import { terminalError } from './terminal-contract.mjs';
import { terminalLaunch } from './terminal-process.mjs';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Command name of a live process owned by this user, or '' (gone, foreign, unreadable).
function processCommand(pid) {
  return new Promise(resolve => {
    execFile('/bin/ps', ['-o', 'uid=,comm=', '-p', String(pid)], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve('');
      const match = /^\s*(\d+)\s+(.+?)\s*$/u.exec(stdout.split('\n')[0] || '');
      resolve(match && Number(match[1]) === process.getuid?.() ? match[2] : '');
    });
  });
}

// Daemon-hosted (background) sessions are stopped through Claude itself so the daemon
// records a stop, keeps the conversation, and does not report a crash.
function stopBackgroundJob(jobId) {
  if (!/^[0-9a-f]{8}$/u.test(jobId)) return Promise.reject(Error('invalid job id'));
  const { shell } = terminalLaunch({ kind: 'shell' });
  return new Promise((resolve, reject) => execFile(shell, ['-lc', `claude stop ${jobId}`], { timeout: 15000 },
    error => (error ? reject(error) : resolve())));
}

const isClaudeCommand = command => /^claude(?:\.exe)?$/u.test(command.split('/').pop().split(/\s/u)[0]);

// Ends every Claude process registered on a conversation chain so the board can resume it.
// Only holders re-read at takeover time, still alive, owned by this user and named claude
// are touched. Background (daemon) jobs are stopped with `claude stop <jobId>` and never
// signalled; interactive holders get SIGTERM, then SIGKILL after the grace period. PID
// reuse is guarded by re-checking the command right before each signal.
export function createClaudeSessionTakeover({ holders, command = processCommand, isAlive = alive, stopJob = stopBackgroundJob,
  signal = (pid, name) => process.kill(pid, name), sleep = pause, graceMs = 5000, pollMs = 100 }) {
  async function waitGone(pids, ms) {
    for (let waited = 0; pids.some(isAlive) && waited < ms; waited += pollMs) await sleep(pollMs);
    return pids.filter(isAlive);
  }
  async function send(pids, name) {
    for (const pid of pids) {
      if (!isClaudeCommand(await command(pid))) continue;
      try { signal(pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  return async function takeover(sessionIds) {
    const found = await holders(sessionIds), jobs = new Map(found.filter(item => item.jobId).map(item => [item.pid, item.jobId]));
    const pids = [...new Set(found.map(item => item.pid))];
    const claude = [];
    for (const pid of pids) if (isClaudeCommand(await command(pid))) claude.push(pid);
    if (claude.length < pids.length) throw terminalError(409, '占用会话的进程无法核实为 Claude，未做任何操作');
    for (const [pid, jobId] of jobs) {
      try { await stopJob(jobId); } catch { throw terminalError(409, `无法停止 Claude 后台会话 ${jobId}（进程 ${pid}），未做任何操作`); }
    }
    await send(claude.filter(pid => !jobs.has(pid)), 'SIGTERM');
    let left = await waitGone(claude, graceMs);
    if (left.some(pid => !jobs.has(pid))) { await send(left.filter(pid => !jobs.has(pid)), 'SIGKILL'); left = await waitGone(left, 2000); }
    if (left.length) throw terminalError(409, `无法结束占用会话的进程 ${left.join(', ')}`);
    if ((await holders(sessionIds)).length) throw terminalError(409, '会话又被其他 Claude 窗口占用，请稍后重试');
    return claude;
  };
}
