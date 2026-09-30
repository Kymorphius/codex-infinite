import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppServerClient } from './app-server-client.mjs';
import { cloneNativeProject } from './native-project-clone.mjs';
import { cloneRolloutPath, readCloneMetadata } from './project-clone-history.mjs';
import { validateContinuationPackage } from './conversation-continuation-package.mjs';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PREPARE_TTL = 10 * 60 * 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => file.startsWith(`${root}${path.sep}`);

async function directory(value, create = false) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value) throw new Error('操作目录必须为规范绝对路径');
  if (create) await fs.mkdir(value, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(value) !== value) throw new Error('操作目录不能使用符号链接或路径别名');
  return value;
}

async function readJson(file, limit = 16 * 1024) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || await fs.realpath(file) !== file) throw new Error('操作记录无效或超过上限');
  const handle = await fs.open(file, 'r');
  try {
    const bytes = await handle.readFile();
    if (bytes.length > limit) throw new Error('操作记录超过上限');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}

async function readSource(file, limit) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit || await fs.realpath(file) !== file) throw new Error('保留的源历史路径无效');
  const bytes = await fs.readFile(file);
  if (bytes.length > limit) throw new Error('保留的源历史超过上限');
  return bytes;
}

async function save(file, value, immutable = false) {
  const bytes = JSON.stringify(value);
  if (immutable) return fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function manifestFor(pkg, target) {
  return {
    projectId: `continuation-${pkg.threadId}`, projectName: pkg.title || '继续工作',
    sessions: [{ sourceThreadId: pkg.threadId, relativePath: 'source.jsonl', timestamp: pkg.timestamp,
      title: pkg.title, cwd: target, sha256: pkg.sha256, bodySha256: pkg.bodySha256, isProjectThread: true }]
  };
}

function threadProjectId(thread) {
  const ids = [thread.projectId, thread.project_id, thread.metadata?.projectId, thread.metadata?.project_id].filter(value => value != null);
  return ids.length && new Set(ids).size === 1 ? ids[0] : null;
}

function expectedSnapshot(expected, target) {
  if (expected == null) return null;
  const keys = ['path', 'head', 'branch', 'sharedProjectId'];
  if (!expected || typeof expected !== 'object' || Object.keys(expected).some(key => !keys.includes(key)) ||
    expected.path !== target || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(expected.head || '') ||
    !(expected.branch === null || typeof expected.branch === 'string' && expected.branch.length > 0 && expected.branch.length <= 256) ||
    typeof expected.sharedProjectId !== 'string' || !expected.sharedProjectId || expected.sharedProjectId.length > 200) throw new Error('目标项目快照无效');
  return Object.fromEntries(keys.map(key => [key, expected[key]]));
}

export class NativeConversationContinuation {
  constructor({ codexPath, codexHome, sessionRoot, receiptRoot, clientFactory } = {}) {
    this.codexPath = codexPath; this.codexHome = codexHome;
    this.sessionRoot = sessionRoot || path.join(codexHome, 'sessions');
    this.receiptRoot = receiptRoot; this.active = new Set(); this.preparing = 0;
    this.clientFactory = clientFactory || (options => new AppServerClient({ ...options, timeoutMs: 30_000 }));
  }

  async operationDirectory(operationId) {
    if (!UUID.test(operationId || '')) throw new Error('操作标识无效');
    await directory(this.receiptRoot);
    return directory(path.join(this.receiptRoot, operationId.toLowerCase()));
  }

  async readPrepared(operationId, expectedPath) {
    const root = await this.operationDirectory(operationId);
    const prepared = await readJson(path.join(root, 'prepared.json'), 12 * 1024 * 1024);
    if (prepared.schemaVersion !== 1 || prepared.operationId !== operationId.toLowerCase() || typeof prepared.note !== 'string' || prepared.note.length > 2000 ||
      !Number.isSafeInteger(prepared.preparedAt) || prepared.expiresAt !== prepared.preparedAt + PREPARE_TTL) throw new Error('操作记录与标识不一致');
    const pkg = validateContinuationPackage(prepared.package);
    if (typeof prepared.path !== 'string' || !path.isAbsolute(prepared.path) || path.resolve(prepared.path) !== prepared.path) throw new Error('记录中的目标目录无效');
    if (expectedPath != null && expectedPath !== prepared.path) throw new Error('操作目标目录已变化');
    prepared.expected = expectedSnapshot(prepared.expected, prepared.path);
    const manifest = await readJson(path.join(root, 'manifest.json'));
    if (JSON.stringify(manifest) !== JSON.stringify(manifestFor(pkg, prepared.path))) throw new Error('操作清单已变化');
    return { root, prepared, pkg, manifest };
  }

  async describe({ operationId }) {
    const { root, prepared, pkg } = await this.readPrepared(operationId);
    const state = await readJson(path.join(root, 'state.json'));
    if (state.operationId !== prepared.operationId || state.schemaVersion !== 1) throw new Error('操作状态无效');
    return { operationId: prepared.operationId, path: prepared.path, sourceThreadId: pkg.threadId,
      sha256: pkg.sha256, title: pkg.title, note: prepared.note, expected: prepared.expected,
      status: state.status, completed: Boolean(state.completedAt), applyAuthorized: state.applyAuthorized === true };
  }

  async operations() {
    await directory(this.receiptRoot, true);
    const names = (await fs.readdir(this.receiptRoot)).filter(name => UUID.test(name));
    if (names.length > 5000) throw new Error('操作记录数量超过上限');
    const records = [];
    for (const operationId of names) {
      const item = await this.describe({ operationId }).catch(() => null);
      if (!item || !item.applyAuthorized || item.completed || !['prepared', 'needs-review'].includes(item.status)) continue;
      const { path: target, sourceThreadId, title, note, status } = item;
      records.push({ operationId, path: target, sourceThreadId, title, note, status, resumeEligible: true });
      if (records.length === 100) break;
    }
    return records;
  }

  async prepare({ package: input, path: targetPath, note = '', expected }) {
    const pkg = validateContinuationPackage(input);
    expected = expectedSnapshot(expected, targetPath);
    if (typeof note !== 'string' || note.length > 2000) throw new Error('交接说明超过上限');
    await directory(targetPath); await directory(this.receiptRoot, true);
    this.preparing++;
    try {
      const names = (await fs.readdir(this.receiptRoot)).filter(name => UUID.test(name));
      if (names.length > 5000) throw new Error('操作记录数量超过上限');
      let outstanding = 0;
      for (const name of names) {
        const state = await readJson(path.join(await this.operationDirectory(name), 'state.json')).catch(() => null);
        if (!state || !state.completedAt && (state.applyAuthorized || !Number.isSafeInteger(state.expiresAt) || state.expiresAt > Date.now())) outstanding++;
      }
      if (outstanding + this.preparing > 32) throw new Error('待处理会话副本过多，请先完成已有操作');
      const operationId = randomUUID(), root = path.join(this.receiptRoot, operationId);
      await fs.mkdir(root, { mode: 0o700 });
      const stage = path.join(root, 'staged'); await fs.mkdir(stage, { mode: 0o700 });
      const bytes = Buffer.from(pkg.base64, 'base64');
      await fs.writeFile(path.join(stage, 'source.jsonl'), bytes, { flag: 'wx', mode: 0o600 });
      await save(path.join(root, 'manifest.json'), manifestFor(pkg, targetPath), true);
      const preparedAt = Date.now(), expiresAt = preparedAt + PREPARE_TTL;
      await save(path.join(root, 'prepared.json'), { schemaVersion: 1, operationId, path: targetPath, note, expected, package: pkg, preparedAt, expiresAt }, true);
      await save(path.join(root, 'state.json'), { schemaVersion: 1, operationId, status: 'prepared', applyAuthorized: false, expiresAt });
      return { operationId, threadId: pkg.threadId };
    } finally { this.preparing--; }
  }

  async existingProject(client, target) {
    const candidates = [], cursors = new Set();
    let cursor = null;
    for (let count = 0; count < 50; count++) {
      const page = await client.request('project/list', { cursor, limit: 100 });
      if (!Array.isArray(page?.data) || page.data.length > 100) throw new Error('原生项目列表格式无效');
      for (const project of page.data) if (project?.roots?.length === 1 && project.roots[0]?.path === target) candidates.push(project);
      cursor = page.nextCursor || null;
      if (!cursor) {
        if (candidates.length !== 1 || typeof candidates[0].id !== 'string' || !candidates[0].id || candidates[0].id.length > 200) throw new Error('目标目录必须对应唯一已登记原生项目');
        return candidates[0];
      }
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('原生项目列表分页无效');
      cursors.add(cursor);
    }
    throw new Error('原生项目列表超过上限');
  }

  async readThread(client, item, actualSessionRoot) {
    const result = await client.request('thread/read', { threadId: item.localThreadId, includeTurns: false });
    const thread = result?.thread;
    if (!thread || (thread.id || thread.threadId) !== item.localThreadId || typeof thread.path !== 'string') throw new Error('原生会话标识未读回确认');
    const actual = await fs.realpath(thread.path);
    if (!inside(actualSessionRoot, actual) || actual !== await fs.realpath(item.path)) throw new Error('原生会话路径未读回确认');
    const metadata = await readCloneMetadata(actual);
    if (metadata.record.payload.id !== item.localThreadId) throw new Error('会话文件标识与操作记录不一致');
    return thread;
  }

  validateReceipt(receipt, record) {
    const item = receipt?.sessions?.[0], target = record.prepared.path;
    const fingerprint = hash(JSON.stringify({ manifest: record.manifest, roots: [target], fallbackCwd: target, codexHome: this.codexHome }));
    if (receipt?.fingerprint !== fingerprint || receipt?.sessions?.length !== 1 || !UUID.test(item?.localThreadId || '') ||
      item.sourceThreadId !== record.pkg.threadId || item.cwd !== target ||
      item.path !== cloneRolloutPath(path.join(this.codexHome, 'sessions'), record.pkg.timestamp, item.localThreadId)) throw new Error('副本收据未确认唯一会话');
    return item;
  }

  execute(options) { return this.run({ ...options, authorize: true }); }
  resume(options) { return this.run(options); }

  async run({ operationId, expectedPath, authorize = false } = {}) {
    if (!UUID.test(operationId || '')) throw new Error('操作标识无效');
    operationId = operationId.toLowerCase();
    if (this.active.has(operationId)) throw new Error('该会话副本操作正在进行');
    this.active.add(operationId);
    let client, state, root;
    try {
      const record = await this.readPrepared(operationId, expectedPath);
      root = record.root;
      const target = record.prepared.path;
      state = await readJson(path.join(root, 'state.json'));
      if (state.schemaVersion !== 1 || state.operationId !== operationId || !['prepared', 'needs-review', 'completed'].includes(state.status)) throw new Error('操作状态无效');
      if (!authorize && state.applyAuthorized !== true) throw new Error('此操作尚未确认执行，请重新预检并确认复制');
      if (state.applyAuthorized !== true && record.prepared.expiresAt <= Date.now()) throw new Error('会话副本预检已过期，请重新预检');
      if (authorize && state.applyAuthorized !== true) {
        state = { ...state, applyAuthorized: true };
        await save(path.join(root, 'state.json'), state);
      }
      await directory(target); await directory(this.codexHome);
      client = await this.clientFactory({ codexPath: this.codexPath, codexHome: this.codexHome });
      await client.initialize();
      const project = await this.existingProject(client, target);
      const nativeSessions = path.join(this.codexHome, 'sessions');
      await fs.mkdir(nativeSessions, { recursive: true, mode: 0o700 });
      if (!path.isAbsolute(this.sessionRoot) || path.resolve(this.sessionRoot) !== this.sessionRoot) throw new Error('会话目录配置无效');
      const actualSessionRoot = await fs.realpath(this.sessionRoot);
      if (!(await fs.stat(this.sessionRoot)).isDirectory() || actualSessionRoot !== await fs.realpath(nativeSessions)) throw new Error('会话目录不符合原生导入配置');
      const clonePath = path.join(root, 'clone.json');
      let receipt = await readJson(clonePath, 32 * 1024).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (receipt) this.validateReceipt(receipt, record);
      if (!state.completedAt && !(receipt?.sessions?.[0]?.indexed && receipt.sessions[0].historyVerified)) {
        const stage = await directory(path.join(root, 'staged'));
        const source = await readSource(path.join(stage, 'source.jsonl'), 8 * 1024 * 1024);
        if (source.length !== record.pkg.bytes || hash(source) !== record.pkg.sha256) throw new Error('保留的源历史已变化');
        let dateDirectory = actualSessionRoot;
        for (const part of record.pkg.timestamp.slice(0, 10).split('-')) dateDirectory = await directory(path.join(dateDirectory, part), true);
        receipt = await cloneNativeProject({ manifest: record.manifest, stagedHome: stage,
          codexHome: this.codexHome, roots: [target], fallbackCwd: target, receiptPath: clonePath,
          client: { initialize: async () => {}, request: (...args) => client.request(...args) }, indexOnly: true });
      }
      const item = this.validateReceipt(receipt, record);
      let thread = await this.readThread(client, item, actualSessionRoot);
      if (!state.completedAt) {
        if (thread.cwd !== target) await client.request('thread/settings/update', { threadId: item.localThreadId, cwd: target });
        if (threadProjectId(thread) !== project.id) await client.request('thread/metadata/update', { threadId: item.localThreadId, projectId: project.id });
        thread = await this.readThread(client, item, actualSessionRoot);
      }
      if (thread.cwd !== target || threadProjectId(thread) !== project.id) throw new Error('原生会话目录或项目归属未读回确认');
      const history = await client.request('thread/turns/list', { threadId: item.localThreadId, limit: 1 });
      if (!Array.isArray(history?.data) || !history.data.length) throw new Error('原生会话历史未读回确认');
      const result = { verified: true, operationId, sourceThreadId: record.pkg.threadId, targetThreadId: item.localThreadId, projectId: project.id,
        path: target, title: record.pkg.title, note: record.prepared.note };
      await save(path.join(root, 'state.json'), { ...state, status: 'completed', targetThreadId: item.localThreadId,
        projectId: project.id, completedAt: state.completedAt || new Date().toISOString() });
      return result;
    } catch (error) {
      if (!root || !state) throw error;
      const message = String(error.message || '原生会话副本未确认').slice(0, 500);
      await save(path.join(root, 'state.json'), { ...state, status: 'needs-review', message }).catch(() => {});
      return { verified: false, operationId, message };
    } finally {
      try { await client?.close(); } finally { this.active.delete(operationId); }
    }
  }
}
