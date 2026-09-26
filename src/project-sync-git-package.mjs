import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { COMMIT_ID, git, gitText, PROJECT_SYNC_MAX_BUNDLE_BYTES, syncError } from './project-sync-git.mjs';
import { validateTree } from './project-sync-git-validation.mjs';

export async function temporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-project-sync-'));
  await fs.chmod(directory, 0o700);
  return directory;
}

export function decodePackage(pkg) {
  if (!pkg || !COMMIT_ID.test(pkg.head) || typeof pkg.branch !== 'string' || !pkg.branch || pkg.branch.length > 256
    || typeof pkg.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(pkg.sha256)
    || typeof pkg.bundle !== 'string' || !pkg.bundle || pkg.bundle.length > Math.ceil(PROJECT_SYNC_MAX_BUNDLE_BYTES / 3) * 4) {
    throw syncError('INVALID_SYNC_PACKAGE', '同步包格式或大小无效。', 400);
  }
  const bytes = Buffer.from(pkg.bundle, 'base64');
  if (bytes.length > PROJECT_SYNC_MAX_BUNDLE_BYTES || bytes.toString('base64') !== pkg.bundle
    || createHash('sha256').update(bytes).digest('hex') !== pkg.sha256) {
    throw syncError('INVALID_SYNC_PACKAGE', '同步包校验失败或超过 24 MiB 上限。', 400);
  }
  return bytes;
}

export async function writePackage(directory, pkg, bytes) {
  const bundlePath = path.join(directory, 'project.bundle');
  await fs.writeFile(bundlePath, bytes, { flag: 'wx', mode: 0o600 });
  const repository = path.join(directory, 'objects.git');
  await git(directory, ['init', '--bare', '--template=', `--object-format=${pkg.head.length === 64 ? 'sha256' : 'sha1'}`, repository]);
  const branch = await git(directory, ['check-ref-format', `refs/heads/${pkg.branch}`], { allowedCodes: [0, 1] });
  if (branch.code !== 0) throw syncError('INVALID_SYNC_PACKAGE', '同步包的分支无效。', 400);
  const heads = await gitText(repository, ['bundle', 'list-heads', bundlePath]);
  if (heads !== `${pkg.head} HEAD`) throw syncError('INVALID_SYNC_PACKAGE', '同步包包含不匹配的提交或引用。', 400);
  // A fresh repository also ensures the package has no missing prerequisite objects.
  await git(repository, ['bundle', 'verify', bundlePath]);
  await git(repository, ['bundle', 'unbundle', bundlePath]);
  if (await gitText(repository, ['cat-file', '-t', pkg.head]) !== 'commit') {
    throw syncError('INVALID_SYNC_PACKAGE', '同步包必须指向有效 Git 提交。', 400);
  }
  await git(repository, ['fsck', '--strict', '--no-reflogs', '--no-dangling', pkg.head]);
  await validateTree(repository, pkg.head);
  return { bundlePath, repository };
}

export async function assertFastForward(repository, source, target) {
  if (source.branch !== target.branch) throw syncError('BRANCH_MISMATCH', '源项目与目标项目的分支不同，请先选择相同分支。');
  if (source.head === target.head) return;
  const available = await git(repository, ['cat-file', '-e', `${target.head}^{commit}`], { allowedCodes: [0, 1, 128] });
  if (available.code !== 0) throw syncError('NOT_FAST_FORWARD', '目标提交不在源项目历史中，不能安全快进同步。');
  const ancestor = await git(repository, ['merge-base', '--is-ancestor', target.head, source.head], { allowedCodes: [0, 1] });
  if (ancestor.code !== 0) throw syncError('NOT_FAST_FORWARD', '源与目标已分叉或目标领先，不能安全快进同步。');
}
