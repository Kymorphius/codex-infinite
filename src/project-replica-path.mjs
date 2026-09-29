import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalInput, exists, git, sameFilesystemPath, syncError } from './project-sync-git.mjs';

export async function replicaDestination(roots, parent, name) {
  canonicalInput(parent);
  if (!roots.includes(parent)) throw syncError('INVALID_DESTINATION', '请选择目标设备允许的创建目录。', 403);
  if (typeof name !== 'string' || !/^[\p{L}\p{N}_][\p{L}\p{N}_. -]{0,79}$/u.test(name)
    || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name)) {
    throw syncError('INVALID_DESTINATION', '新目录名须为 1–80 个字，不能含路径分隔符、保留名称或尾随点空格。', 400);
  }
  const stat = await fs.lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFilesystemPath(await fs.realpath(parent), parent)) throw syncError('INVALID_DESTINATION', '创建父目录必须是实际目录，不能使用符号链接。');
  await fs.access(parent, fs.constants.W_OK);
  const repository = await git(parent, ['rev-parse', '--git-dir'], { allowedCodes: [0, 128] });
  if (repository.code === 0) throw syncError('INVALID_DESTINATION', '不能在已有 Git 仓库内创建新副本。');
  const destination = path.join(parent, name);
  if (await exists(destination)) throw syncError('DESTINATION_EXISTS', '目标目录已存在，请选择新名称；已有副本请使用同步页面。');
  return destination;
}
