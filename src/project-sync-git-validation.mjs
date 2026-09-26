import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalInput, COMMIT_ID, exists, git, gitText, sameFilesystemPath, syncError } from './project-sync-git.mjs';

const TERMINAL_TASKS = new Set(['idle', 'completed', 'complete', 'interrupted', 'error', 'failed', 'cancelled', 'canceled', 'archived']);
const SPECIAL_STATE = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_LOG', 'rebase-apply', 'rebase-merge',
  'index.lock', 'HEAD.lock', 'shallow', 'info/grafts', 'objects/info/alternates', 'info/sparse-checkout'];
const CHECKOUT_FILTER = /(^|[\t ])[-!]?filter(?:[=\s]|$)/m;

function overlaps(first, second) {
  if (process.platform === 'win32') { first = first.toLowerCase(); second = second.toLowerCase(); }
  return first === second || first.startsWith(`${second}${path.sep}`) || second.startsWith(`${first}${path.sep}`);
}

function credentialFile(file) {
  const name = path.posix.basename(file).toLowerCase();
  return (/^\.env(?:\.|$)/.test(name) && !/\.(example|sample|template|defaults)$/.test(name))
    || /^(?:\.netrc|\.npmrc|\.pypirc|auth\.json|credentials(?:\.[\w-]+)?|secrets?(?:\.(json|ya?ml|toml))?|id_(?:rsa|dsa|ecdsa|ed25519))$/.test(name)
    || /\.(?:pem|p12|pfx|key)$/.test(name) || /(?:^|\/)(?:\.ssh|\.aws|\.gnupg)(?:\/|$)/i.test(file);
}

export async function validateTree(root, revision) {
  if (!COMMIT_ID.test(revision)) throw syncError('INVALID_COMMIT', '提交标识无效。', 400);
  const entries = (await git(root, ['ls-tree', '-rz', '--full-tree', revision])).stdout.split('\0').filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    if (entry.startsWith('160000 ') || path.posix.basename(file) === '.gitmodules') {
      throw syncError('UNSUPPORTED_SUBMODULE', '当前版本暂不支持含子模块的项目。');
    }
    if (credentialFile(file)) throw syncError('CREDENTIAL_FILE', '项目记录包含常见凭据文件，请先移除敏感内容并确认历史记录。');
    if (path.posix.basename(file) === '.gitattributes') {
      const objectId = entry.slice(0, tab).split(' ')[2];
      if (CHECKOUT_FILTER.test((await git(root, ['cat-file', 'blob', objectId], { maxBuffer: 1024 * 1024 })).stdout)) {
        throw syncError('UNSUPPORTED_FILTER', '当前版本暂不支持需要 checkout 过滤器的项目。');
      }
    }
  }
  // Names from history matter too: a deleted secret is still included in a full bundle.
  const history = (await git(root, ['log', '--no-show-signature', '--format=', '--name-only', '-z', revision])).stdout.split('\0');
  if (history.some(file => credentialFile(file.replace(/^\n+/, '')))) {
    throw syncError('CREDENTIAL_FILE', '项目历史包含常见凭据文件，不能通过同步包传输。');
  }
  const lfs = await git(root, ['grep', '--no-textconv', '-I', '-l', '-E', '^version https://git-lfs.github.com/spec/v1$', revision, '--'], { allowedCodes: [0, 1] });
  if (lfs.code === 0) throw syncError('UNSUPPORTED_LFS', '当前版本暂不支持 Git LFS 项目。');
}

async function validateWorkingAttributes(root) {
  const staged = (await git(root, ['ls-files', '--stage', '-z'])).stdout.split('\0').filter(Boolean);
  const files = [];
  for (const entry of staged) {
    const file = entry.slice(entry.indexOf('\t') + 1);
    files.push(file);
    if (entry.startsWith('160000 ') || path.posix.basename(file) === '.gitmodules') {
      throw syncError('UNSUPPORTED_SUBMODULE', 'Git 暂存区包含子模块，不能安全检查工作区。');
    }
    if (path.posix.basename(file) !== '.gitattributes') continue;
    const objectId = entry.split(' ')[1];
    if (!COMMIT_ID.test(objectId) || CHECKOUT_FILTER.test((await git(root, ['cat-file', 'blob', objectId], { maxBuffer: 1024 * 1024 })).stdout)) {
      throw syncError('UNSUPPORTED_FILTER', 'Git 暂存区包含 checkout 过滤器，不能安全检查工作区。');
    }
  }
  // Without excludes this lists both ignored and ordinary untracked attribute files,
  // including directories that will only become tracked when the incoming tree is applied.
  const otherAttributes = (await git(root, ['ls-files', '--others', '-z', '--', '.gitattributes', '**/.gitattributes'])).stdout.split('\0').filter(Boolean);
  files.push(...otherAttributes);
  const directories = new Set(['']);
  for (const file of files) {
    let directory = path.posix.dirname(file);
    while (directory !== '.' && directory !== '') {
      directories.add(directory);
      directory = path.posix.dirname(directory);
    }
  }
  for (const directory of directories) {
    const file = path.join(root, directory, '.gitattributes');
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; });
    if (!stat) continue;
    if (!stat.isFile() || stat.size > 1024 * 1024) throw syncError('UNSUPPORTED_FILTER', '工作区的 Git attributes 文件不可安全读取。');
    if (CHECKOUT_FILTER.test(await fs.readFile(file, 'utf8'))) {
      throw syncError('UNSUPPORTED_FILTER', '当前版本暂不支持需要 checkout 过滤器的项目。');
    }
  }
}

export async function validateRegisteredRoot(root, projects) {
  canonicalInput(root);
  if (!Array.isArray(projects) || !projects.some(project => project?.path === root)) {
    throw syncError('PROJECT_NOT_REGISTERED', '项目目录未在当前设备登记。', 403);
  }
  let stat;
  try { stat = await fs.lstat(root); } catch { throw syncError('PROJECT_UNAVAILABLE', '项目目录不可读取。'); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFilesystemPath(await fs.realpath(root), root)) {
    throw syncError('UNSUPPORTED_PROJECT_PATH', '请选择实际项目根目录；不支持符号链接目录。');
  }
  const dotGit = path.join(root, '.git');
  const gitStat = await fs.lstat(dotGit).catch(() => null);
  if (!gitStat?.isDirectory() || gitStat.isSymbolicLink() || !sameFilesystemPath(await fs.realpath(dotGit), dotGit)) {
    throw syncError('UNSUPPORTED_REPOSITORY', '仅支持普通 Git 根目录，暂不支持 worktree 或裸仓库。');
  }
  const [top, common, gitDir, inside] = await Promise.all([
    gitText(root, ['rev-parse', '--show-toplevel']), gitText(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    gitText(root, ['rev-parse', '--absolute-git-dir']), gitText(root, ['rev-parse', '--is-inside-work-tree'])
  ]);
  if (!sameFilesystemPath(top, root) || !sameFilesystemPath(common, dotGit) || !sameFilesystemPath(gitDir, dotGit) || inside !== 'true') {
    throw syncError('UNSUPPORTED_REPOSITORY', '请选择普通 Git 项目的完整根目录。');
  }
  for (const component of ['objects', 'refs', 'index', 'config', 'HEAD', 'info']) {
    const file = path.join(dotGit, component);
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isSymbolicLink() || (stat && !sameFilesystemPath(await fs.realpath(file), file))) {
      throw syncError('UNSUPPORTED_GIT_STATE', '当前版本暂不支持通过符号链接共享 Git 状态的仓库。');
    }
  }
  const attributes = await fs.lstat(path.join(dotGit, 'info', 'attributes')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (attributes && (!attributes.isFile() || attributes.size > 0)) {
    throw syncError('UNSUPPORTED_FILTER', '当前版本暂不支持本机 .git/info/attributes，请先移除其中的工作区规则。');
  }
  for (const file of SPECIAL_STATE) {
    if (await exists(path.join(dotGit, file))) throw syncError('UNSUPPORTED_GIT_STATE', '仓库存在进行中的 Git 操作或不受支持的工作区配置。');
  }
  for (const directory of ['worktrees', 'modules', 'refs/replace']) {
    if ((await fs.readdir(path.join(dotGit, directory)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).length) {
      throw syncError('UNSUPPORTED_GIT_STATE', '当前版本暂不支持 worktree、子模块或替换对象。');
    }
  }
  const sparse = await gitText(root, ['config', '--bool', '--get', 'core.sparseCheckout'], { allowedCodes: [0, 1] });
  if (sparse === 'true') throw syncError('UNSUPPORTED_GIT_STATE', '当前版本暂不支持稀疏工作区。');
  const partial = await gitText(root, ['config', '--get-regexp', '^(extensions[.]partialclone|remote[.].*[.]promisor)$'], { allowedCodes: [0, 1] });
  const replacements = await gitText(root, ['for-each-ref', '--format=%(refname)', 'refs/replace']);
  if (partial || replacements) throw syncError('UNSUPPORTED_GIT_STATE', '当前版本暂不支持部分克隆或替换对象。');
}

export async function validateTasks(root, tasks) {
  if (!Array.isArray(tasks)) throw syncError('TASK_STATUS_UNAVAILABLE', '无法确认设备任务状态，请稍后重试。');
  for (const task of tasks) {
    if (TERMINAL_TASKS.has(task?.status)) continue;
    if (!task?.cwd || typeof task.cwd !== 'string' || !path.isAbsolute(task.cwd)) {
      throw syncError('TASK_STATUS_UNAVAILABLE', '设备存在无法确认工作目录或状态的任务，请先确认任务已停止。');
    }
    const cwd = await fs.realpath(task.cwd).catch(() => path.resolve(task.cwd));
    if (overlaps(root, cwd)) throw syncError('PROJECT_BUSY', '项目存在进行中或状态未知的任务，请先停止任务再同步。');
  }
}

export async function repositorySnapshot(root) {
  const branch = await gitText(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowedCodes: [0, 1] });
  if (!branch) throw syncError('DETACHED_HEAD', '项目当前没有可同步的分支。');
  const head = await gitText(root, ['rev-parse', '--verify', 'HEAD']);
  if (!COMMIT_ID.test(head)) throw syncError('INVALID_COMMIT', '项目尚无有效提交。');
  // Validate object and on-disk attribute rules before status can invoke a clean driver.
  await validateTree(root, head);
  await validateWorkingAttributes(root);
  const dirty = await gitText(root, ['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']);
  // These flags hide tracked modifications from porcelain; reject them outright.
  const flags = (await git(root, ['ls-files', '-v', '-z'])).stdout.split('\0').filter(Boolean);
  if (dirty || flags.some(entry => /^[a-zS] /.test(entry))) throw syncError('DIRTY_PROJECT', '项目有未提交、未跟踪或被隐藏的工作区改动，请先处理后同步。');
  return { path: root, branch, head, clean: true };
}

export async function validateIgnoredCollisions(root, sourceRoot, sourceHead, targetHead) {
  const normalize = file => (['win32', 'darwin'].includes(process.platform) ? file.toLowerCase() : file).replace(/\/+$/, '');
  const local = (await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z'])).stdout.split('\0').filter(Boolean).map(normalize);
  if (!local.length) return;
  const changes = (await git(sourceRoot, ['diff-tree', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-r', '-z', targetHead, sourceHead])).stdout.split('\0').filter(Boolean).map(normalize);
  if (changes.some(file => local.some(ignored => file === ignored || file.startsWith(`${ignored}/`) || ignored.startsWith(`${file}/`)))) {
    throw syncError('IGNORED_FILE_COLLISION', '同步内容与目标设备保留的 ignored 文件重叠，请先调整目标目录。');
  }
}
