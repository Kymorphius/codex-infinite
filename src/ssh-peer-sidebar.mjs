import crypto from 'node:crypto';
import { ACTION_HEADERS, loadActionKey, signPeerAction } from './peer-action-auth.mjs';
import { normalizeSidebarSnapshot, normalizeSidebarAction, sidebarError } from './sidebar-contract.mjs';
import { SIDEBAR_ACTION_PATH, sshActionArguments, sshSidebarArguments } from './ssh-peer-commands.mjs';

function execute(spawn, args, body) {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => { child.kill(); reject(sidebarError('所属设备未及时响应，请刷新核对操作结果', 504)); }, 18000);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) child.kill(); else chunks.push(chunk); });
    child.stderr.on('data', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code || size > 4 * 1024 * 1024) reject(sidebarError('所属设备通信失败，请刷新核对操作结果', 503));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(body);
  });
}

export class SshPeerSidebar {
  constructor({ peer, execFile, spawn, actionKeyPath } = {}) { Object.assign(this, { peer, execFile, spawn, actionKeyPath }); }
  routes() { return this.preferred ? [this.preferred, ...this.peer.transports.filter(route => route !== this.preferred)] : this.peer.transports; }
  async read() {
    let failure;
    for (const transport of this.routes()) {
      try {
        const { stdout } = await this.execFile('ssh', sshSidebarArguments(transport, { remotePlatform: this.peer.platform }), { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024 });
        const payload = JSON.parse(stdout);
        if (payload.status === 'error') throw sidebarError(String(payload.message || '原生侧边栏未就绪').slice(0, 200), 503);
        const snapshot = normalizeSidebarSnapshot(payload); this.preferred = transport; return snapshot;
      } catch (error) { if (error.statusCode) failure = error; }
    }
    throw failure || sidebarError('设备离线或不支持原生侧边栏', 503);
  }
  async apply(input) {
    const action = normalizeSidebarAction(input), key = await loadActionKey(this.actionKeyPath);
    const timestamp = String(Date.now()), nonce = crypto.randomUUID();
    const body = Buffer.from(JSON.stringify(action));
    const headers = { [ACTION_HEADERS.timestamp]: timestamp, [ACTION_HEADERS.nonce]: nonce };
    headers[ACTION_HEADERS.signature] = signPeerAction(key, { method: 'POST', path: SIDEBAR_ACTION_PATH, timestamp, nonce, body });
    for (const transport of this.routes()) {
      let payload;
      try { payload = JSON.parse(await execute(this.spawn, sshActionArguments(transport, headers, SIDEBAR_ACTION_PATH, { remotePlatform: this.peer.platform }), body)); }
      catch { continue; } // Same signed nonce: owner receipts prevent duplicate native writes.
      if (payload.status !== 'ok' || !payload.applied || !payload.snapshot) throw sidebarError(payload.message || '所属设备未确认修改', 409);
      this.preferred = transport;
      return { applied: true, sectionId: payload.sectionId, opened: payload.opened === true, snapshot: normalizeSidebarSnapshot(payload.snapshot) };
    }
    throw sidebarError('无法确认所属设备的操作结果，请刷新核对', 503);
  }
}
