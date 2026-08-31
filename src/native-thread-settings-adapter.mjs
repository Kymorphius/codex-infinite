import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { httpError } from "./http-utils.mjs";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ownerRejectionMessage(message) {
  const text = String(message || "").slice(0, 240);
  if (/already has an active writer/i.test(text)) {
    return "这个会话正在对方的原生 ChatGPT 中运行；真实设置仍会同步显示，但修改需要由当前持有会话的原生进程执行";
  }
  return text || "所属节点没有应用会话设置";
}

function applySettingsExpression(threadId, changes) {
  return `(async () => {
    const apply = window.__codexControlConsoleApplyThreadSettings;
    if (typeof apply !== 'function') return { ok: false, unavailable: true, message: '所属节点的原生设置服务尚未就绪' };
    try {
      const result = await apply(${JSON.stringify(threadId)}, ${JSON.stringify(changes)});
      return { ok: Boolean(result?.applied) };
    } catch (error) {
      return { ok: false, message: String(error?.message || '所属节点拒绝了设置变更').slice(0, 240) };
    }
  })()`;
}

export class NativeThreadSettingsAdapter {
  constructor({ cdpOrigin, router = null, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.router = router;
  }

  async connect(threadId) {
    if (this.router) return this.router.connect(threadId);
    const target = this.choose(await this.discover(this.cdpOrigin));
    const connection = this.connectionFactory(target.webSocketDebuggerUrl);
    await connection.connect();
    return { connection, ownerSurface: "dedicated-native", ownerBridge: "direct" };
  }

  async apply({ threadId, changes }) {
    const normalized = String(threadId || "").trim().toLowerCase();
    if (!THREAD_ID_PATTERN.test(normalized)) throw httpError(400, "原生 Codex 会话标识无效");
    let connection;
    try {
      const routed = await this.connect(normalized);
      connection = routed.connection;
      const result = await connection.evaluate(applySettingsExpression(normalized, changes));
      if (!result?.ok) throw httpError(result?.unavailable ? 503 : 409, ownerRejectionMessage(result?.message));
      return { applied: true, threadId: normalized, ownerSurface: routed.ownerSurface, ownerBridge: routed.ownerBridge };
    } catch (error) {
      if (error?.statusCode) throw error;
      throw httpError(503, "所属节点的原生设置服务不可用");
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}
