import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFileCallback);
const MAX_FILES = 150;
const gitOptions = { timeout: 5000, maxBuffer: 768 * 1024, windowsHide: true, encoding: 'utf8' };

export function parseNativeChangeStats(output, untracked = '') {
  const files = [], seen = new Set();
  for (const row of output.split('\0')) {
    if (!row) continue;
    const first = row.indexOf('\t'), second = row.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const name = row.slice(second + 1);
    if (!name || /[\x00-\x1f\x7f]/u.test(name) || seen.has(name)) continue;
    seen.add(name);
    files.push({ name, added: Number(row.slice(0, first)) || 0, removed: Number(row.slice(first + 1, second)) || 0, untracked: false });
    if (files.length >= MAX_FILES) return files;
  }
  for (const name of untracked.split('\0')) {
    if (!name || /[\x00-\x1f\x7f]/u.test(name) || seen.has(name)) continue;
    seen.add(name); files.push({ name, added: 0, removed: 0, untracked: true });
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

export async function readNativeTerminalChanges(cwd, file = null, { execute = runFile } = {}) {
  const run = async args => (await execute('git', ['--no-pager', '--no-optional-locks', '-C', cwd, ...args], gitOptions)).stdout;
  let stats, untracked;
  try {
    [stats, untracked] = await Promise.all([
      run(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative', '--numstat', '-z', 'HEAD', '--', '.']).catch(async error => {
        if (![1, 128].includes(error.code)) throw error;
        const worktree = await run(['rev-parse', '--is-inside-work-tree']);
        if (worktree.trim() !== 'true') throw error;
        return '';
      }),
      run(['ls-files', '--others', '--exclude-standard', '-z', '--', '.'])
    ]);
  } catch (error) {
    if (file !== null) throw new Error('无法读取这个项目的变更');
    return { files: [], unavailable: error.code === 128 ? '当前目录不是可预览的 Git 工作区' : '暂时无法读取变更，请稍后重试' };
  }
  const files = parseNativeChangeStats(stats, untracked);
  if (file === null) return { files };
  const selected = files.find(entry => entry.name === file);
  if (!selected) throw new Error('文件不在当前会话的变更列表中');
  if (selected.untracked) return { file: selected, patch: '', note: '未跟踪文件尚无可比较的版本。' };
  try {
    const patch = await run(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--relative', 'HEAD', '--', file]);
    return { file: selected, patch };
  } catch {
    throw new Error('变更较大或暂时无法读取，请在终端查看');
  }
}
