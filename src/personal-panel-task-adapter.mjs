import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { normalizePersonalPanelTaskList } from './personal-panel-task-contract.mjs';

export class PersonalPanelTaskAdapter {
  constructor({ scriptPath, nodePath = process.execPath, readTimeoutMs = 60000, writeTimeoutMs = 210000, run = null }) {
    this.scriptPath = scriptPath;
    this.nodePath = nodePath;
    this.readTimeoutMs = readTimeoutMs;
    this.writeTimeoutMs = writeTimeoutMs;
    this.run = run || (request => this.#run(request));
  }

  async #run(request) {
    if (!path.isAbsolute(this.scriptPath || '')) throw new Error('Personal Panel 桥接尚未配置');
    await access(this.scriptPath);
    return new Promise((resolve, reject) => {
      const child = spawn(this.nodePath, [this.scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
      let output = '', failed = false;
      const timeoutMs = request.op === 'task.list' || request.op === 'task.get' ? this.readTimeoutMs : this.writeTimeoutMs;
      const timer = setTimeout(() => { failed = true; child.kill(); reject(new Error('Personal Panel 响应超时；请刷新核对，不要直接重试写入')); }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { output += chunk; if (output.length > 1024 * 1024) { failed = true; child.kill(); reject(new Error('Personal Panel 响应过大')); } });
      child.on('error', error => { if (!failed) { failed = true; clearTimeout(timer); reject(error); } });
      child.on('close', code => {
        clearTimeout(timer);
        if (failed) return;
        if (code !== 0) {
          let errorCode = '';
          try { errorCode = JSON.parse(output)?.error?.code || ''; } catch { /* malformed failures stay generic */ }
          const message = errorCode === 'READ_FAILED' ? 'Personal Panel 未运行或原生任务不可读' : errorCode === 'CONFLICT' || errorCode === 'OWNER_CHANGED' ? 'Anytype 原生任务已变化，请刷新核对' : errorCode === 'WRITE_UNCERTAIN' ? '原生写入结果未确认，请刷新核对，勿直接重试' : 'Personal Panel 操作未确认；请刷新原生任务核对';
          return reject(new Error(message));
        }
        try { resolve(JSON.parse(output)); } catch { reject(new Error('Personal Panel 响应格式无效')); }
      });
      child.stdin.end(JSON.stringify(request));
    });
  }

  async list() { return normalizePersonalPanelTaskList(await this.run({ op: 'task.list', limit: 100, cursor: null })); }
  async mutate(request) { return this.run(request); }
}
