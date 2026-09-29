import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { terminalError } from './terminal-contract.mjs';
import { claudeLaunchArgs, claudeLaunchEnvironment, CLAUDE_CLI_MODEL_PATTERN } from './claude-terminal-settings.mjs';

const execute = promisify(execFile);
const ENV_KEYS = ['PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'TMP', 'TEMP',
  'USER', 'LOGNAME', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'];
const CLAUDE_TERMINAL_UI_PROMPT = 'This Claude session is shown in Codex Control Console. You may control only your current display through Bash by writing OSC 777 to /dev/tty. Open the read-only code changes pane with: printf "\\033]777;ccc-ui:split=open\\007" > /dev/tty. Close it with split=close, refresh it with split=refresh, and request a repaint of a scrambled terminal display with ccc-ui:redraw. Use these when helpful; they do not alter files or conversation input.';
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function terminalEnvironment({ userHome = os.homedir(), shell, env = process.env } = {}) {
  const clean = {};
  for (const key of ENV_KEYS) if (typeof env[key] === 'string') clean[key] = env[key];
  return { ...clean, HOME: userHome, ...(process.platform === 'win32' ? { USERPROFILE: userHome } : {}),
    SHELL: shell, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
}

export async function validateTerminalCwd(cwd) {
  if (!path.isAbsolute(cwd)) throw terminalError(400, '请填写绝对工作目录');
  try { if (!(await fs.stat(cwd)).isDirectory()) throw Error('not a directory'); }
  catch { throw terminalError(400, '工作目录不存在或不可访问'); }
  return cwd;
}

export function terminalLaunch({ kind, claudeSessionId, resume = false, attachJob, claudeSettings = null, env = process.env, platform = process.platform } = {}) {
  if (claudeSessionId !== undefined && (typeof claudeSessionId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(claudeSessionId))) {
    throw terminalError(400, 'Claude 会话标识无效');
  }
  // A daemon-hosted background session is opened with `claude attach`, which shares it
  // with other viewers instead of resuming (which would fork a copy).
  if (attachJob !== undefined && (typeof attachJob !== 'string' || !/^[0-9a-f]{8}$/u.test(attachJob))) throw terminalError(400, 'Claude 后台会话标识无效');
  // Model and effort come only from the settings catalog; the argument check also guards cmd /c,
  // which has no quoting. An attached job keeps the model its owner started it with.
  const modelArgs = kind === 'claude' && !attachJob ? claudeLaunchArgs(claudeSettings) : [];
  if (modelArgs.length && !CLAUDE_CLI_MODEL_PATTERN.test(modelArgs[1])) throw terminalError(400, 'Claude 模型无效');
  const model = modelArgs.map(value => `${platform === 'win32' || value.startsWith('--') ? value : shellQuote(value)} `).join('');
  const command = attachJob ? `claude attach ${attachJob}`
    : claudeSessionId ? `claude ${model}${resume ? '--resume' : '--session-id'} ${claudeSessionId}` : `claude${model ? ' ' + model.trimEnd() : ''}`;
  const withUiControls = kind === 'claude' && !attachJob && platform !== 'win32'
    ? command.replace(/^claude\b/u, `claude --append-system-prompt ${shellQuote(CLAUDE_TERMINAL_UI_PROMPT)}`) : command;
  const withPermissions = kind === 'claude' && !attachJob
    ? withUiControls.replace(/^claude\b/u, 'claude --permission-mode bypassPermissions') : withUiControls;
  if (platform === 'win32') {
    const shell = env.COMSPEC || path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
    return { shell, args: kind === 'claude' ? ['/d', '/s', '/c', withPermissions] : ['/d'] };
  }
  const shell = path.isAbsolute(env.SHELL || '') ? env.SHELL : (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { shell, args: kind === 'claude' ? ['-lic', withPermissions] : ['-l'] };
}

// Only processes descended from this adapter's PTY are eligible for cleanup.
export async function killTerminalProcess(pty, { platform = process.platform, executeCommand = execute, kill = process.kill } = {}) {
  const pid = pty.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid) return;
  if (platform === 'win32') {
    try { await executeCommand('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 2000 }); }
    catch { try { pty.kill(); } catch {} }
    return;
  }
  const descendants = [];
  try {
    const { stdout } = await executeCommand('/bin/ps', ['-A', '-o', 'pid=,ppid=,tty='], { timeout: 2000, maxBuffer: 2 * 1024 * 1024 });
    const parents = new Map();
    for (const line of stdout.split('\n')) {
      const [childText, parentText, tty] = line.trim().split(/\s+/u), child = Number(childText), parent = Number(parentText);
      // A descendant without a controlling terminal detached itself on purpose (e.g. the
      // Claude daemon hosting every background session). Like closing a terminal window,
      // leave it and everything below it running.
      if (!tty || tty === '??' || tty === '?') continue;
      if (child > 1 && child !== process.pid && Number.isSafeInteger(parent)) {
        if (!parents.has(parent)) parents.set(parent, []);
        parents.get(parent).push(child);
      }
    }
    const pending = [pid], seen = new Set(pending);
    while (pending.length) for (const child of parents.get(pending.shift()) || []) {
      if (!seen.has(child)) { seen.add(child); descendants.push(child); pending.push(child); }
    }
  } catch {}
  // forkpty creates a new session/process group; never signal the console group.
  try { kill(-pid, 'SIGHUP'); } catch {}
  for (const child of descendants.reverse()) { try { kill(child, 'SIGKILL'); } catch {} }
  try { pty.kill('SIGKILL'); } catch {}
}

export async function spawnTerminalProcess({ cwd, kind, cols, rows, claudeSessionId, resume, attachJob, claudeSettings = null,
  userHome = os.homedir(), env = process.env } = {}) {
  let library;
  try { library = await import('node-pty'); }
  catch { throw terminalError(503, '终端组件不可用，请重新安装本机依赖后重试'); }
  const { shell, args } = terminalLaunch({ kind, claudeSessionId, resume, attachJob, claudeSettings, env });
  const extra = kind === 'claude' && !attachJob ? claudeLaunchEnvironment(claudeSettings) : {};
  let pty;
  try {
    pty = (library.spawn || library.default.spawn)(shell, args, {
      name: 'xterm-256color', cwd, cols, rows, env: { ...terminalEnvironment({ userHome, shell, env }), ...extra },
    });
  } catch { throw terminalError(503, '无法启动本机终端，请检查登录 Shell 和终端组件'); }
  return { write: data => pty.write(data), resize: (width, height) => pty.resize(width, height),
    onData: listener => pty.onData(listener), onExit: listener => pty.onExit(listener),
    kill: () => killTerminalProcess(pty) };
}
