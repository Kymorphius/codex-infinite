import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { httpError } from "./http-utils.mjs";

function routeError(route) {
  if (route.state === "bridge-unavailable") {
    return httpError(503, "这个会话正由对方的原生 ChatGPT 持有，但该原生界面桥接尚未启用；为避免抢占会话，未改用另一套后台进程");
  }
  if (route.state === "inspection-unavailable") return httpError(503, "暂时无法确认当前持有会话的原生界面");
  return httpError(409, "无法安全确认当前持有会话的原生界面，设置没有发送");
}

export class NativeDesktopRouter {
  constructor({ writerLocator, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.writerLocator = writerLocator;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
  }

  async connect(threadId) {
    const route = await this.writerLocator.locate(threadId);
    if (route.state !== "ready") throw routeError(route);
    try {
      const target = this.choose(await this.discover(route.cdpOrigin));
      const connection = this.connectionFactory(target.webSocketDebuggerUrl);
      await connection.connect();
      return { connection, ownerSurface: route.surface, ownerBridge: route.bridge };
    } catch (error) {
      if (error?.statusCode) throw error;
      const label = route.surface === "primary-native" ? "对方当前持有会话的原生 ChatGPT" : "所属节点的原生设置服务";
      throw httpError(503, `${label}暂时不可连接`);
    }
  }
}
