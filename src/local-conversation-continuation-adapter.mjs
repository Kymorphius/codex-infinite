import path from 'node:path';
import { LocalProjectReplicaAdapter } from './local-project-replica-adapter.mjs';
import { exportContinuation, validateContinuationPackage } from './conversation-continuation-package.mjs';
import { assertExpected } from './project-sync-git.mjs';
import { syncError } from './project-sync-contract.mjs';

const terminal = new Set(['idle', 'completed', 'interrupted', 'error', 'cancelled']);
function within(root, cwd) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false;
  const relative = path.relative(root, cwd);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export class LocalConversationContinuationAdapter extends LocalProjectReplicaAdapter {
  constructor({ taskReader, sessionRoots, continuation, ...options }) { super(options); Object.assign(this, { taskReader, sessionRoots, continuation }); }
  async conversationOperations() {
    this.#available();
    const { projects } = await this.catalog(), paths = new Set(projects.map(project => project.path));
    return { operations: (await this.continuation.operations()).filter(record => paths.has(record.path)) };
  }
  async conversationList({ path: root } = {}) {
    await this.inspect({ path: root });
    const tasks = await this.taskProvider();
    return { conversations: tasks.filter(task => within(root, task.cwd)).slice(0, 1000).map(task => ({ threadId: task.id, title: task.title, status: task.status, eligible: terminal.has(task.status) && !task.isSubagent, reason: task.isSubagent ? '子会话须与完整会话图一起复制' : terminal.has(task.status) ? '' : '请先结束源会话的当前任务' })) };
  }
  async conversationExport({ path: root, threadId } = {}) {
    await this.inspect({ path: root });
    return exportContinuation({ root, threadId, taskProvider: this.taskProvider, taskReader: this.taskReader, sessionRoots: this.sessionRoots });
  }
  async conversationPrepare({ path: root, expected, package: pkg, note } = {}) {
    this.#available(); this.#expected(await this.inspect({ path: root }), expected);
    validateContinuationPackage(pkg);
    const snapshot = { path: root, head: expected.head, branch: expected.branch, sharedProjectId: expected.sharedProjectId };
    const result = await this.continuation.prepare({ package: pkg, path: root, note, expected: snapshot });
    return { operationId: result.operationId, path: root };
  }
  async conversationApply({ operationId, expected } = {}) {
    this.#available(); const saved = await this.continuation.describe({ operationId });
    this.#expected(saved.expected, expected);
    this.#expected(await this.inspect({ path: saved.path }), saved.expected);
    return this.continuation.execute({ operationId, expectedPath: saved.path });
  }
  async conversationResume({ operationId } = {}) {
    this.#available(); const saved = await this.continuation.describe({ operationId });
    const current = await this.inspect({ path: saved.path });
    if (!saved.completed) this.#expected(current, saved.expected);
    return this.continuation.resume({ operationId, expectedPath: saved.path });
  }
  #available() { if (!this.continuation) throw syncError('该设备尚未支持会话复制', 503); }
  #expected(current, expected) {
    if (!expected || current.sharedProjectId !== expected.sharedProjectId || !current.sharedProjectId) throw syncError('目标项目关联已变化，请重新预检');
    assertExpected(current, expected);
  }
}
