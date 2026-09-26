import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
export const PROJECT_SYNC_MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
export const PROJECT_SYNC_TOKEN_TTL_MS = 10 * 60 * 1000;
export const PROJECT_SYNC_MAX_TOKENS = 8;
export const COMMIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export function syncError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

export async function git(root, args, { allowedCodes = [0], maxBuffer = 8 * 1024 * 1024, encoding = 'utf8' } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ATTR_NOSYSTEM: '1', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' });
  const command = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'gc.auto=0',
    '-c', 'maintenance.auto=false', '-c', 'submodule.recurse=false', '-c', 'core.quotePath=false', ...args];
  try {
    const result = await execFileAsync('git', command, { cwd: root, env, timeout: 30_000, maxBuffer, encoding, windowsHide: true });
    return { ...result, code: 0 };
  } catch (error) {
    if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' && encoding === 'buffer') {
      throw syncError('SYNC_PACKAGE_TOO_LARGE', '项目同步包超过 24 MiB 上限。');
    }
    if (allowedCodes.includes(error.code) && !error.killed) return { stdout: error.stdout || '', stderr: '', code: error.code };
    throw syncError('GIT_OPERATION_FAILED', 'Git 操作未完成；请检查仓库状态后重新预检。');
  }
}

export function sameFilesystemPath(first, second, platform = process.platform) {
  if (platform === 'win32') return path.win32.normalize(first).toLowerCase() === path.win32.normalize(second).toLowerCase();
  return path.posix.normalize(first) === path.posix.normalize(second);
}

export async function gitText(root, args, options) {
  return (await git(root, args, options)).stdout.trim();
}

export async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function canonicalInput(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || path.resolve(value) !== value) {
    throw syncError('INVALID_PROJECT_PATH', '请选择已登记项目的完整根目录。', 400);
  }
  return value;
}

export function assertExpected(snapshot, expected) {
  if (!expected || expected.path !== snapshot.path || expected.branch !== snapshot.branch || expected.head !== snapshot.head) {
    throw syncError('PROJECT_CHANGED', '项目分支或提交已变化，请重新预检。');
  }
}
