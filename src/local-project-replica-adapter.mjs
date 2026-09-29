import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalProjectIdentityAdapter } from './local-project-identity-adapter.mjs';
import { replicaDestination } from './project-replica-path.mjs';
import { decodePackage, temporaryDirectory, writePackage } from './project-sync-git-package.mjs';
import { repositorySnapshot, validateRegisteredRoot } from './project-sync-git-validation.mjs';
import { assertExpected, git, PROJECT_SYNC_TOKEN_TTL_MS, sameFilesystemPath, syncError } from './project-sync-git.mjs';

export class LocalProjectReplicaAdapter extends LocalProjectIdentityAdapter {
  #prepared = new Map();
  #pending = 0;
  #resuming = new Set();
  constructor({ creationRoots = [], registrar, receiptDirectory, ...options }) {
    super(options); Object.assign(this, { creationRoots, registrar, receiptDirectory });
  }
  async createOptions() {
    if (!this.registrar || !this.receiptDirectory) throw syncError('CREATION_UNAVAILABLE', '该设备尚未配置新副本创建。', 503);
    await this.registrar.ready();
    const roots = [];
    for (const root of this.creationRoots) {
      try { await replicaDestination(this.creationRoots, root, `check-${randomUUID()}`); roots.push(root); } catch { /* Only offer valid configured parents. */ }
    }
    const recoveries = [];
    const files = await fs.readdir(this.receiptDirectory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const file of files.filter(file => /^[a-f0-9-]{36}\.json$/.test(file)).slice(-100)) {
      const full = path.join(this.receiptDirectory, file), stat = await fs.lstat(full);
      if (!stat.isFile() || stat.size > 16384) continue;
      const record = JSON.parse(await fs.readFile(full, 'utf8'));
      if (['needs-review', 'awaiting-registration'].includes(record.phase) && typeof record.path === 'string' && this.creationRoots.includes(path.dirname(record.path))) {
        recoveries.push({ operationId: record.operationId, path: record.path, head: record.head });
      }
    }
    return { roots, recoveries };
  }
  async disposeCreations() {
    const pending = [...this.#prepared.values()]; this.#prepared.clear();
    await Promise.all(pending.map(entry => fs.rm(entry.directory, { recursive: true, force: true })));
  }
  async #cleanup() {
    for (const [token, entry] of this.#prepared) if (entry.expiresAt <= this.now()) {
      this.#prepared.delete(token); await fs.rm(entry.directory, { recursive: true, force: true });
    }
  }
  async createPrepare({ parent, name, package: pkg } = {}) {
    await this.#cleanup();
    if (this.#prepared.size + this.#pending >= 8) throw syncError('TOO_MANY_PREFLIGHTS', '创建预检过多，请稍后重试。', 429);
    this.#pending++;
    let directory;
    try {
      await this.createOptions();
      const destination = await replicaDestination(this.creationRoots, parent, name);
      const bytes = decodePackage(pkg); directory = await temporaryDirectory();
      await writePackage(directory, pkg, bytes);
      const token = randomUUID(), expiresAt = this.now() + PROJECT_SYNC_TOKEN_TTL_MS;
      this.#prepared.set(token, { parent, name, destination, directory, pkg, expiresAt }); directory = null;
      return { token, path: destination, head: pkg.head, branch: pkg.branch };
    } finally { this.#pending--; if (directory) await fs.rm(directory, { recursive: true, force: true }); }
  }
  async createApply({ token } = {}) {
    await this.#cleanup();
    const entry = this.#prepared.get(token); this.#prepared.delete(token);
    if (!entry) throw syncError('PREFLIGHT_EXPIRED', '新副本预检已过期或使用，请重新检查。');
    const { parent, name, destination, directory, pkg } = entry;
    const operationId = randomUUID();
    let created = false, receipt;
    const save = async phase => {
      receipt = { operationId, path: destination, head: pkg.head, branch: pkg.branch, phase, updatedAt: new Date().toISOString() };
      await fs.mkdir(this.receiptDirectory, { recursive: true, mode: 0o700 });
      const file = path.join(this.receiptDirectory, `${operationId}.json`), temp = `${file}.tmp`;
      await fs.writeFile(temp, JSON.stringify(receipt), { mode: 0o600 }); await fs.rename(temp, file);
    };
    try {
      await this.registrar.ready();
      await replicaDestination(this.creationRoots, parent, name);
      await save('creating');
      await fs.mkdir(destination, { mode: 0o700 }); created = true;
      const owned = await fs.lstat(destination);
      const checkOwned = async () => {
        const current = await fs.lstat(destination);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== owned.dev || current.ino !== owned.ino
          || !sameFilesystemPath(await fs.realpath(destination), destination)) throw Error('新副本目录在创建期间被替换，请手动核对');
      };
      // Build only Git objects and the tracked tree; no source config, hooks or ignored files.
      const { bundlePath } = await writePackage(await fs.mkdtemp(path.join(directory, 'verify-')), pkg, decodePackage(pkg));
      await checkOwned();
      await git(destination, ['init', '--template=', `--object-format=${pkg.head.length === 64 ? 'sha256' : 'sha1'}`]);
      await checkOwned();
      await git(destination, ['bundle', 'unbundle', bundlePath]);
      await checkOwned();
      await git(destination, ['checkout', '-b', pkg.branch, pkg.head]);
      const expected = { path: destination, head: pkg.head, branch: pkg.branch };
      assertExpected(await repositorySnapshot(destination), expected);
      await save('awaiting-registration');
      await checkOwned();
      const registered = await this.registrar.register({ path: destination, name });
      if (!registered?.projectId) throw Error('原生项目没有确认登记');
      const target = await this.inspect({ path: destination }); assertExpected(target, expected);
      await save('completed');
      return { verified: true, operationId, projectId: registered.projectId, target };
    } catch (error) {
      if (receipt) await save(created ? 'needs-review' : 'not-created').catch(() => {});
      if (created) return { verified: false, operationId, path: destination, message: `副本目录已保留。${error.message}。可确认后继续登记，不会重新复制代码。` };
      throw error;
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
  async createResume({ operationId } = {}) {
    if (typeof operationId !== 'string' || !/^[a-f0-9-]{36}$/.test(operationId)) throw syncError('INVALID_OPERATION', '创建记录标识无效。', 400);
    if (this.#resuming.has(operationId)) throw syncError('OPERATION_BUSY', '该副本正在登记，请稍后核对。');
    this.#resuming.add(operationId);
    try {
      const file = path.join(this.receiptDirectory, `${operationId}.json`);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > 16384) throw Error('创建记录不可读取');
      const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.operationId !== operationId || !['needs-review', 'awaiting-registration', 'completed'].includes(record.phase)
        || !this.creationRoots.includes(path.dirname(record.path))) throw Error('创建记录不可恢复');
      const expected = { path: record.path, head: record.head, branch: record.branch };
      await validateRegisteredRoot(record.path, [{ path: record.path }]);
      assertExpected(await repositorySnapshot(record.path), expected);
      let project = (await this.catalog()).projects.find(project => project.path === record.path);
      if (!project) {
        await this.registrar.ready();
        await this.registrar.register({ path: record.path, name: path.basename(record.path) });
      }
      const target = await this.inspect({ path: record.path }); assertExpected(target, expected);
      const temp = `${file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify({ ...record, phase: 'completed', updatedAt: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, file);
      return { verified: true, operationId, target };
    } finally { this.#resuming.delete(operationId); }
  }

}
