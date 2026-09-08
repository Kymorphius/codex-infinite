import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeWindowsSourcePath, validatePreflightToken, validateProjectCopySelection } from "./project-copy-contract.mjs";

const TOKEN_TTL_MS = 10 * 60_000;

async function localFiles(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`复制结果包含符号链接: ${entry.name}`);
      if (entry.isDirectory()) stack.push(absolute);
      else if (entry.isFile()) {
        const [body, stat] = await Promise.all([fs.readFile(absolute), fs.stat(absolute)]);
        result.push({ path: path.relative(root, absolute).split(path.sep).join("/"), bytes: stat.size, sha256: crypto.createHash("sha256").update(body).digest("hex") });
      } else throw new Error(`复制结果包含不支持的文件类型: ${entry.name}`);
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

function assertManifestMatches(expected, actual, { ignoredPaths = [] } = {}) {
  const ignored = new Set(ignoredPaths);
  const checkedExpected = expected.filter((entry) => !ignored.has(entry.path));
  const checkedActual = actual.filter((entry) => !ignored.has(entry.path));
  if (checkedExpected.length !== checkedActual.length) throw new Error("复制校验失败：文件数量不一致");
  const actualByPath = new Map(checkedActual.map((entry) => [entry.path, entry]));
  if (actualByPath.size !== checkedActual.length) throw new Error("复制校验失败：存在重复路径");
  for (const left of checkedExpected) {
    const right = actualByPath.get(left.path);
    if (!right || left.bytes !== right.bytes || left.sha256 !== right.sha256) throw new Error(`复制校验失败：${left.path}`);
  }
}

function isSameWindowsDirectory(left, right) {
  try {
    return normalizeWindowsSourcePath(left).toLowerCase() === normalizeWindowsSourcePath(right).toLowerCase();
  } catch {
    return false;
  }
}

export class ProjectCopyService {
  constructor({ taskAdapter, copyAdapters = [], nativeImporter = null, receiptStore = null, allowedRoots = [], now = () => Date.now() } = {}) {
    this.taskAdapter = taskAdapter;
    this.copyAdapters = new Map(copyAdapters.map((adapter) => [adapter.peer.id, adapter]));
    this.allowedRoots = allowedRoots;
    this.nativeImporter = nativeImporter;
    this.receiptStore = receiptStore;
    this.now = now;
    this.preflights = new Map();
  }

  options() {
    return { destinationRoots: this.allowedRoots.slice() };
  }

  async preflight(input) {
    const selection = validateProjectCopySelection(input, { allowedRoots: this.allowedRoots });
    const snapshot = await this.taskAdapter.listTasks();
    const projectTasks = snapshot.tasks?.filter((task) => task.device?.id === selection.deviceId && task.device.kind !== "local-codex" && isSameWindowsDirectory(task.cwd, selection.sourceDirectory)) || [];
    if (!projectTasks.length) throw Object.assign(new Error("源目录不属于当前可见的远端项目"), { statusCode: 404 });
    if (projectTasks.some((task) => task.status === "active")) throw Object.assign(new Error("项目仍有进行中的远端会话，请完成或停止后再复制"), { statusCode: 409 });
    if (projectTasks.length > 32) throw Object.assign(new Error("项目会话数量超过首版复制上限"), { statusCode: 409 });
    const adapter = this.copyAdapters.get(selection.deviceId);
    if (!adapter) throw Object.assign(new Error("此设备暂不支持项目复制"), { statusCode: 409 });
    const exclusions = ["target"];
    const manifest = await adapter.preflight(selection.sourceDirectory, exclusions);
    let existingDestination = false;
    try {
      const stat = await fs.lstat(selection.destinationDirectory);
      if (!stat.isDirectory()) throw new Error("目标路径已经存在且不是目录");
      assertManifestMatches(manifest.files, await localFiles(selection.destinationDirectory), { ignoredPaths: [".git/index"] });
      existingDestination = true;
    } catch (error) {
      if (error.code === "ENOENT") {
        try { await fs.access(path.dirname(selection.destinationDirectory), fs.constants.W_OK); } catch { throw Object.assign(new Error("目标目录的上级目录不存在或不可写"), { statusCode: 409 }); }
      } else if (!existingDestination) throw Object.assign(new Error(error.message.startsWith("复制校验失败") ? "目标目录已存在但内容与远端项目不一致" : error.message), { statusCode: 409 });
    }
    const threadIds = projectTasks.map((task) => task.id.toLowerCase());
    const threadNames = new Map(projectTasks.map((task) => [task.id.toLowerCase(), String(task.title || "").trim().slice(0, 160)]));
    const sessionManifest = await adapter.preflightSessions(threadIds);
    const token = crypto.randomBytes(32).toString("hex");
    const projectName = projectTasks[0].projectDisplayName || projectTasks[0].project || path.basename(selection.destinationDirectory);
    this.preflights.set(token, { selection, manifest, sessionManifest, threadNames, projectName, adapter, existingDestination, expiresAt: this.now() + TOKEN_TTL_MS });
    return { token, sourceDirectory: selection.sourceDirectory, destinationDirectory: selection.destinationDirectory, fileCount: manifest.fileCount, directoryCount: manifest.directoryCount, bytes: manifest.bytes, excluded: exclusions, conversationCount: sessionManifest.sessions.length, conversationBytes: sessionManifest.bytes, existingDestination };
  }

  async execute(input) {
    const token = validatePreflightToken(input.preflightToken);
    const record = this.preflights.get(token);
    this.preflights.delete(token);
    if (!record || record.expiresAt < this.now()) throw Object.assign(new Error("复制预检已过期，请重新检查"), { statusCode: 409 });
    const selection = validateProjectCopySelection(input, { allowedRoots: this.allowedRoots });
    if (JSON.stringify(selection) !== JSON.stringify(record.selection)) throw Object.assign(new Error("复制选择已变化，请重新检查"), { statusCode: 409 });
    const destination = selection.destinationDirectory;
    const staging = path.join(path.dirname(destination), `.${path.basename(destination)}.codex-copy-${crypto.randomUUID()}`);
    const sessionStaging = path.join(path.dirname(destination), `.${path.basename(destination)}.codex-sessions-${crypto.randomUUID()}`);
    const sessionCheck = `${sessionStaging}-check`;
    let destinationCreated = false;
    try {
      if (!record.existingDestination) {
        try { await fs.lstat(destination); throw Object.assign(new Error("目标目录已经存在"), { statusCode: 409 }); } catch (error) { if (error.code !== "ENOENT") throw error; }
        await record.adapter.download(record.manifest, staging);
        assertManifestMatches(record.manifest.files, await localFiles(staging));
        await fs.rename(staging, destination);
        destinationCreated = true;
      } else assertManifestMatches(record.manifest.files, await localFiles(destination), { ignoredPaths: [".git/index"] });
      await record.adapter.downloadSessions(record.sessionManifest, sessionStaging);
      await record.adapter.downloadSessions(record.sessionManifest, sessionCheck);
      const firstSessions = await localFiles(sessionStaging);
      assertManifestMatches(firstSessions, await localFiles(sessionCheck));
      const expectedSizes = new Map(record.sessionManifest.sessions.map((item) => [`${item.sourceThreadId}.jsonl`, item.bytes]));
      if (firstSessions.some((item) => expectedSizes.get(item.path) !== item.bytes)) throw new Error("远端会话在复制期间发生了变化");
      if (!this.nativeImporter) throw new Error("本机原生会话导入服务不可用");
      const copyId = crypto.randomUUID();
      const startedAt = new Date(this.now()).toISOString();
      await this.receiptStore?.append?.({ copyId, status: "importing", sourceDeviceId: selection.deviceId, sourceDirectory: selection.sourceDirectory, destinationDirectory: destination, sourceThreadIds: record.sessionManifest.sessions.map((item) => item.sourceThreadId), startedAt });
      const imported = await this.nativeImporter.import({
        sessions: record.sessionManifest.sessions.map((item) => ({ sourceThreadId: item.sourceThreadId, path: path.join(sessionStaging, `${item.sourceThreadId}.jsonl`), title: record.threadNames.get(item.sourceThreadId) || null })),
        destinationDirectory: destination, projectName: record.projectName, idempotencyKey: copyId
      });
      let receiptRecorded = true;
      try { await this.receiptStore?.append?.({ copyId, status: "completed", sourceDeviceId: selection.deviceId, sourceDirectory: selection.sourceDirectory, destinationDirectory: destination, projectId: imported.projectId, conversations: imported.conversations, completedAt: new Date(this.now()).toISOString() }); }
      catch { receiptRecorded = false; }
      return { destinationDirectory: destination, fileCount: record.manifest.fileCount, bytes: record.manifest.bytes, conversationCount: imported.conversations.length, conversations: imported.conversations, projectId: imported.projectId, receiptRecorded, verified: true };
    } catch (error) {
      await fs.rm(staging, { recursive: true, force: true });
      if (destinationCreated) await fs.rm(destination, { recursive: true, force: true });
      throw error;
    } finally {
      await fs.rm(sessionStaging, { recursive: true, force: true });
      await fs.rm(sessionCheck, { recursive: true, force: true });
    }
  }
}
