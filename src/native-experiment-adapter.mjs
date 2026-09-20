import { CdpConnection, chooseMainTarget, discoverTargets } from './cdp-client.mjs';
import { normalizeExperimentItems } from './experiment-contract.mjs';

export function buildExperimentReadScript() {
  return `(${readNativeExperiments.toString()})()`;
}
async function readNativeExperiments() {
  const w = window;
  const definitions = [
    ['conversation-tabs', '多会话标签页', '在原生窗口中保留多个会话标签。', Boolean(w.__codexControlConsoleConversationTabs)],
    ['unified-sidebar', '多设备统一侧边栏', '显示各设备原生分区及任务。', w.__codexControlConsoleUnifiedSidebar?.enabled === true],
    ['new-projects', '新项目入口', '根据本机项目状态提供新项目入口。', Boolean(w.__codexControlConsoleNewProjects)],
    ['context', '按会话扩展上下文', '扩展能力已加载；是否启用大窗口仍由各会话设置决定。', typeof w.__codexControlConsoleGetContextWindow === 'function'],
    ['turbo', 'Turbo 策略支持', '策略支持已加载；不表示所有会话都启用了 Turbo。', typeof w.__codexControlConsoleSetTurboPolicy === 'function'],
    ['approvals', '远程审批支持', '原生审批捕获能力已加载。', Boolean(w.__codexControlConsoleNativeApprovalVersion)],
    ['sidebar-labels', '设备与项目标签', '原生侧边栏设备和项目标签扩展已加载。', Boolean(w.__codexControlConsoleSidebarLabelObserver)],
    ['attention-sticky', '关注分区固定标题', '关注分区标题固定扩展已加载。', Boolean(w.__codexControlConsoleAttentionStickyObserver)]
  ];
  const consoleGroup = { status: 'connected', items: definitions.map(([name, title, description, enabled]) => ({ name, title, description, enabled, stage: '控制台扩展' })) };
  const request = cursor => new Promise((resolve, reject) => {
    const id = 'console-experiments-' + crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); w.removeEventListener('message', receive); };
    const receive = event => {
      const data = event.data;
      if (data?.type !== 'mcp-response' || data.hostId !== 'local' || data.message?.id !== id) return;
      cleanup();
      if (data.message.error) reject(new Error('Native experiments unavailable'));
      else resolve(data.message.result);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Native experiments timed out')); }, 5000);
    w.addEventListener('message', receive);
    try {
      Promise.resolve(w.electronBridge.sendMessageFromView({ type: 'mcp-request', hostId: 'local', retainResponse: true,
        request: { id, method: 'experimentalFeature/list', params: { cursor, limit: 100 } } }))
        .catch(error => { cleanup(); reject(error); });
    } catch (error) { cleanup(); reject(error); }
  });
  try {
    let cursor = null;
    const seen = new Set(), items = [];
    for (let page = 0; page < 20; page++) {
      const result = await request(cursor);
      if (!Array.isArray(result?.data)) throw new Error('Invalid native inventory');
      items.push(...result.data);
      cursor = result.nextCursor;
      if (cursor == null) return { native: { status: 'connected', items }, console: consoleGroup };
      if (typeof cursor !== 'string' || seen.has(cursor)) throw new Error('Invalid native pagination');
      seen.add(cursor);
    }
    throw new Error('Native inventory exceeds limit');
  } catch { return { native: { status: 'unavailable', items: [] }, console: consoleGroup }; }
}

export class NativeExperimentAdapter {
  constructor({ cdpOrigin, discover = discoverTargets, choose = chooseMainTarget,
    connectionFactory = url => new CdpConnection(url, { commandTimeoutMs: 15000 }) }) {
    Object.assign(this, { cdpOrigin, discover, choose, connectionFactory });
  }
  async read() {
    let connection;
    try {
      const target = this.choose(await this.discover(this.cdpOrigin));
      connection = this.connectionFactory(target.webSocketDebuggerUrl);
      await connection.connect();
      const snapshot = await connection.evaluate(buildExperimentReadScript());
      if (snapshot.native?.status === 'connected') snapshot.native.items = normalizeExperimentItems(snapshot.native.items)
        .filter(item => !['stable', 'removed', 'deprecated'].includes(item.stage));
      return { ...snapshot, observedAt: new Date().toISOString() };
    } finally { await connection?.close().catch(() => {}); }
  }
}
