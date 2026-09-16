import { buildNativeSidebarVisibilityScript } from './native-sidebar-visibility.mjs';
import crypto from 'node:crypto';
import { CdpConnection, chooseMainTarget, discoverTargets } from './cdp-client.mjs';
import { buildNativeSidebarReadScript } from './native-sidebar-model.mjs';
import { buildNativeSidebarActionScript, buildNativeSidebarCapabilitiesScript } from './native-sidebar-actions.mjs';
import { normalizeSidebarSnapshot, sidebarLayout, normalizeSidebarAction, validateSidebarAction, sidebarError } from './sidebar-contract.mjs';

export function sidebarActionApplied(before, after, action, result = {}) {
  const old = before.sections.find(section => section.id === action.sectionId);
  const section = after.sections.find(section => section.id === action.sectionId);
  switch (action.action) {
    case 'section-create': return after.sections.some(section => section.id === result.sectionId && section.name === action.name);
    case 'section-rename': return section?.name === action.name;
    case 'section-delete': return !section;
    case 'section-shift': return after.sections.findIndex(section => section.id === action.sectionId) === before.sections.indexOf(old) + action.direction;
    case 'item-move': return after.sections.find(section => section.id === action.targetSectionId)?.itemKeys.includes(action.itemKey) === true
      && !after.sections.some(section => section.id !== action.targetSectionId && section.itemKeys.includes(action.itemKey));
    case 'item-shift': return section?.itemKeys.indexOf(action.itemKey) === old.itemKeys.indexOf(action.itemKey) + action.direction;
    case 'open': return result.opened === true;
    default: return false;
  }
}

export class NativeSidebarAdapter {
  constructor({ cdpOrigin, titleIndex = null, taskAdapter = null, discover = discoverTargets, choose = chooseMainTarget,
    connectionFactory = url => new CdpConnection(url), verifyAttempts = 20, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    Object.assign(this, { cdpOrigin, titleIndex, taskAdapter, discover, choose, connectionFactory, verifyAttempts, wait });
    this.chain = Promise.resolve();
  }
  async connect() {
    const target = this.choose(await this.discover(this.cdpOrigin));
    const connection = this.connectionFactory(target.webSocketDebuggerUrl); await connection.connect(); return connection;
  }
  async readConnection(connection) {
    let raw;
    try { raw = await connection.evaluate(buildNativeSidebarReadScript()); }
    catch { throw sidebarError('原生分区当前不可读取，请显示该设备分区后重试', 503); }
    const titles = await this.titleIndex?.read?.() || new Map();
    for (const conversation of raw.conversations || []) {
      const task = this.taskAdapter?.taskIndex?.get(conversation.id);
      if (conversation.source === 'codex') conversation.title = task?.title || titles.get(conversation.id) || conversation.title || '会话 ' + conversation.id.slice(0, 8);
      conversation.cwd = task?.cwd || null; conversation.status = task?.status || 'unknown';
    }
    let capabilities = {};
    try { capabilities = await connection.evaluate(buildNativeSidebarCapabilitiesScript()); } catch { /* Read remains available when mutations are unsupported. */ }
    raw.capabilities = ['sidebar-show', 'open', 'section-shift', 'item-shift', ...Object.entries(capabilities).filter(([, ready]) => ready)
      .map(([name]) => ({ create: 'section-create', rename: 'section-rename', delete: 'section-delete', move: 'item-move' })[name])];
    const snapshot = normalizeSidebarSnapshot(raw);
    snapshot.revision = crypto.createHash('sha256').update(sidebarLayout(snapshot)).digest('hex');
    return snapshot;
  }
  async read() {
    let connection;
    try { connection = await this.connect(); return await this.readConnection(connection); }
    finally { await connection?.close().catch(() => {}); }
  }
  apply(input) {
    const pending = this.chain.then(() => this.applyOne(input)); this.chain = pending.catch(() => {}); return pending;
  }
  async applyOne(input) {
    let connection;
    try {
      connection = await this.connect();
      const normalized = normalizeSidebarAction(input);
      if (normalized.action === 'sidebar-show') {
        await connection.evaluate(buildNativeSidebarVisibilityScript());
        for (let attempt = 0; attempt < this.verifyAttempts; attempt++) {
          await this.wait(150);
          try { return { applied: true, snapshot: await this.readConnection(connection) }; } catch { await connection.evaluate(buildNativeSidebarVisibilityScript()); }
        }
        throw sidebarError('该设备未能显示原生分区，请检查来源窗口', 503);
      }
      const before = await this.readConnection(connection), action = validateSidebarAction(before, normalized);
      if (!before.capabilities.includes(action.action)) throw sidebarError('当前原生版本不支持此操作', 409);
      let result;
      try { result = await connection.evaluate(buildNativeSidebarActionScript(action, sidebarLayout(before))); }
      catch (error) {
        if (action.action !== 'open') throw error;
        throw sidebarError('原生项目入口暂不可用，请显示所属设备的项目分区后重试', 503);
      }
      let stable = 0;
      for (let attempt = 0; attempt < this.verifyAttempts; attempt++) {
        await this.wait(150);
        const snapshot = await this.readConnection(connection);
        if (sidebarActionApplied(before, snapshot, action, result)) {
          stable += 1;
          if (stable >= 2) return { applied: true, ...result, snapshot };
        } else stable = 0;
      }
      throw sidebarError('原生侧边栏尚未确认修改，请刷新后核对', 409);
    } finally { await connection?.close().catch(() => {}); }
  }
}
