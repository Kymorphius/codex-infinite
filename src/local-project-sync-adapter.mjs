import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assertExpected, git, PROJECT_SYNC_MAX_BUNDLE_BYTES, PROJECT_SYNC_MAX_TOKENS, PROJECT_SYNC_TOKEN_TTL_MS, syncError } from './project-sync-git.mjs';
import { repositorySnapshot, validateIgnoredCollisions, validateRegisteredRoot, validateTasks } from './project-sync-git-validation.mjs';
import { assertFastForward, decodePackage, temporaryDirectory, writePackage } from './project-sync-git-package.mjs';

export class LocalProjectSyncAdapter {
  #tokens = new Map();
  #preparing = 0;
  #applying = new Set();

  constructor({ projectProvider, taskProvider, now = Date.now } = {}) {
    this.projectProvider = projectProvider;
    this.taskProvider = taskProvider;
    this.now = now;
  }

  async #cleanup() {
    const expired = [];
    for (const [token, entry] of this.#tokens) {
      if (this.now() >= entry.expiresAt) {
        this.#tokens.delete(token);
        expired.push(fs.rm(entry.directory, { recursive: true, force: true }));
      }
    }
    await Promise.all(expired);
  }

  async catalog() {
    await this.#cleanup();
    const projects = await this.projectProvider?.();
    if (!Array.isArray(projects)) throw syncError('PROJECT_CATALOG_UNAVAILABLE', '无法读取当前设备的项目清单。');
    const unique = new Map();
    for (const project of projects) {
      if (typeof project?.path !== 'string' || !path.isAbsolute(project.path)) continue;
      const root = path.resolve(project.path);
      unique.set(root, { path: root, name: String(project.name || path.basename(root)).slice(0, 200) });
    }
    return { projects: [...unique.values()] };
  }

  async inspect({ path: root } = {}) {
    const { projects } = await this.catalog();
    await validateRegisteredRoot(root, projects);
    const tasks = await this.taskProvider?.();
    await validateTasks(root, tasks);
    return repositorySnapshot(root);
  }

  async export({ path: root, expected } = {}) {
    const snapshot = await this.inspect({ path: root });
    assertExpected(snapshot, expected);
    const { stdout: bytes } = await git(root, ['bundle', 'create', '-', 'HEAD'], { encoding: 'buffer', maxBuffer: PROJECT_SYNC_MAX_BUNDLE_BYTES });
    assertExpected(await this.inspect({ path: root }), snapshot);
    return { head: snapshot.head, branch: snapshot.branch, bundle: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  async prepare({ path: root, expected, package: pkg } = {}) {
    await this.#cleanup();
    if (this.#tokens.size + this.#preparing >= PROJECT_SYNC_MAX_TOKENS) throw syncError('TOO_MANY_PREFLIGHTS', '待执行的同步预检过多，请稍后重试。', 429);
    this.#preparing += 1;
    let directory;
    try {
      const target = await this.inspect({ path: root });
      assertExpected(target, expected);
      const bytes = decodePackage(pkg);
      directory = await temporaryDirectory();
      const { repository, bundlePath } = await writePackage(directory, pkg, bytes);
      const source = { head: pkg.head, branch: pkg.branch };
      await assertFastForward(repository, source, target);
      await validateIgnoredCollisions(root, repository, source.head, target.head);
      assertExpected(await this.inspect({ path: root }), target);
      const token = randomUUID();
      const unchanged = source.head === target.head;
      this.#tokens.set(token, { directory, repository, bundlePath, source, target, unchanged, expiresAt: this.now() + PROJECT_SYNC_TOKEN_TTL_MS });
      directory = null;
      return { token, source, target, unchanged };
    } finally {
      this.#preparing -= 1;
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  }

  async apply({ token } = {}) {
    await this.#cleanup();
    const entry = typeof token === 'string' ? this.#tokens.get(token) : null;
    if (!entry) throw syncError('PREFLIGHT_EXPIRED', '预检已过期、已使用或不存在，请重新预检。');
    this.#tokens.delete(token);
    const root = entry.target.path;
    let acquired = false;
    try {
      if (this.#applying.has(root)) throw syncError('PROJECT_BUSY', '项目正在同步，请等待完成后重新预检。');
      this.#applying.add(root);
      acquired = true;
      assertExpected(await this.inspect({ path: root }), entry.target);
      await validateIgnoredCollisions(root, entry.repository, entry.source.head, entry.target.head);
      if (!entry.unchanged) {
        await git(root, ['bundle', 'unbundle', entry.bundlePath]);
        assertExpected(await this.inspect({ path: root }), entry.target);
        await git(root, ['-c', `branch.${entry.target.branch}.mergeOptions=`, 'merge', '--ff-only', '--no-squash', '--no-edit', '--no-autostash', '--no-overwrite-ignore', entry.source.head]);
      }
      const target = await this.inspect({ path: root });
      assertExpected(target, { path: root, ...entry.source });
      return { verified: true, unchanged: entry.unchanged, target };
    } finally {
      if (acquired) this.#applying.delete(root);
      await fs.rm(entry.directory, { recursive: true, force: true });
    }
  }
}
