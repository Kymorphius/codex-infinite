import crypto from 'node:crypto';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { promisify } from 'node:util';
import { ACTION_HEADERS, loadActionKey, signPeerAction } from './peer-action-auth.mjs';
import { sshTaskCenterArguments, sshActionArguments, TASK_CENTER_ACTION_PATH, TASK_IMAGES_ACTION_PATH } from './ssh-peer-commands.mjs';
import { normalizeTaskCenterAction, taskCenterError } from './task-center-contract.mjs';

function execute(spawn, args, body, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(taskCenterError('TIMEOUT', '所属设备响应超时，请刷新核对', 504)); }, 65000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code || size > maxBytes) reject(taskCenterError('TRANSPORT_FAILED', '无法核对设备响应，请刷新重试', 503));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(body);
  });
}

export class SshPeerTaskCenter {
  constructor({ peer, actionKeyPath, execFile = promisify(nodeExecFile), spawn = nodeSpawn } = {}) {
    Object.assign(this, { peer, actionKeyPath, execFile, spawn });
  }
  routes() { return this.preferred ? [this.preferred, ...this.peer.transports.filter(route => route !== this.preferred)] : this.peer.transports; }
  async read() {
    let unsupported = false;
    for (const transport of this.routes()) {
      let payload;
      try {
        const { stdout } = await this.execFile('ssh', sshTaskCenterArguments(transport, { remotePlatform: this.peer.platform }), {
          encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024
        });
        payload = JSON.parse(stdout);
      } catch { continue; }
      if (payload?.version !== 1 || !Array.isArray(payload.items) || payload.device?.id !== this.peer.id) { unsupported = true; continue; }
      this.preferred = transport; return payload;
    }
    throw taskCenterError(unsupported ? 'UNSUPPORTED_NODE' : 'OFFLINE', unsupported ? '设备尚不支持统一任务管理，请更新该节点' : '来源设备暂不可达', 503);
  }
  async request(path, input, maxBytes = 16 * 1024 * 1024) {
    const key = await loadActionKey(this.actionKeyPath), timestamp = String(Date.now()), nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify(input));
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: 'POST', path, timestamp, nonce, body });
    for (const transport of this.routes()) {
      let result;
      try { result = JSON.parse(await execute(this.spawn, sshActionArguments(transport, headers, path, { remotePlatform: this.peer.platform }), body, maxBytes)); }
      catch { continue; }
      if (!result || typeof result !== 'object' || !['ok', 'error'].includes(result.status)) continue;
      if (result.status !== 'ok') throw taskCenterError(result.code || 'OWNER_REJECTED', result.message || '来源设备未确认操作，请刷新核对', 409);
      this.preferred = transport; return result;
    }
    throw taskCenterError('UNCONFIRMED', '设备响应未确认，请刷新核对结果后再操作', 503);
  }
  apply(input) { return this.request(TASK_CENTER_ACTION_PATH, normalizeTaskCenterAction(input)); }
  images(input) { return this.request(TASK_IMAGES_ACTION_PATH, input, 34 * 1024 * 1024); }
}
