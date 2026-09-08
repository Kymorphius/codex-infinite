import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { decideChatgptProjectMove, normalizeChatgptProjectMoveRequest } from "./chatgpt-project-move-contract.mjs";

function rendererLookup(conversationId, projectId, { invoke = false } = {}) {
  return `(async () => {
    const conversationId = ${JSON.stringify(conversationId)};
    const projectId = ${JSON.stringify(projectId)};
    for (const title of document.querySelectorAll('[data-thread-title]')) {
      let row = title;
      while (row && row.getAttribute?.('role') !== 'button') row = row.parentElement;
      const rowFiberKey = row && Object.getOwnPropertyNames(row).find((name) => name.startsWith('__reactFiber'));
      let rowFiber = rowFiberKey ? row[rowFiberKey] : null;
      while (rowFiber && rowFiber.memoizedProps?.conversationId !== conversationId) rowFiber = rowFiber.return;
      if (rowFiber?.memoizedProps?.projectId) {
        return {
          found: true,
          source: 'chatgpt',
          conversationOrigin: rowFiber.memoizedProps.conversationOrigin || null,
          projectId: rowFiber.memoizedProps.projectId,
          rowAvailable: true,
          moveActionAvailable: false
        };
      }
    }
    const key = 'chatgpt:conversation:' + conversationId;
    const row = [...document.querySelectorAll('[data-sidebar-chatgpt-conversation-key]')]
      .find((item) => item.getAttribute('data-sidebar-chatgpt-conversation-key') === key);
    const sourceAnchor = row || document.querySelector('[data-sidebar-chatgpt-conversation-key]');
    const fiberKey = sourceAnchor && Object.getOwnPropertyNames(sourceAnchor).find((name) => name.startsWith('__reactFiber'));
    let fiber = fiberKey ? sourceAnchor[fiberKey] : null;
    let sourceFiber = fiber;
    while (sourceFiber && !sourceFiber.memoizedProps?.chatGptSource) sourceFiber = sourceFiber.return;
    const source = sourceFiber?.memoizedProps?.chatGptSource;
    const target = source?.chatTargets?.find?.((item) => item?.conversationId === conversationId);
    if (!target) return { found: false };
    const snapshot = {
      found: true,
      source: target.source || null,
      conversationOrigin: target.conversation?.conversation_origin || null,
      projectId: target.projectId || null,
      rowAvailable: Boolean(row),
      moveActionAvailable: false
    };
    if (snapshot.source !== 'chatgpt' || snapshot.conversationOrigin === 'tpp' || snapshot.projectId) return snapshot;
    if (!row) return snapshot;
    const button = row.querySelector('button[aria-label="聊天操作"]');
    const buttonFiberKey = button && Object.getOwnPropertyNames(button).find((name) => name.startsWith('__reactFiber'));
    let menuFiber = buttonFiberKey ? button[buttonFiberKey] : null;
    while (menuFiber && typeof menuFiber.memoizedProps?.getMenuItems !== 'function') menuFiber = menuFiber.return;
    if (!menuFiber) return snapshot;
    let menuItems;
    try { menuItems = menuFiber.memoizedProps.getMenuItems(); } catch { return snapshot; }
    const moveMenu = menuItems?.find?.((item) => item?.id === 'move-chatgpt-conversation-to-project');
    const actionId = 'move-chatgpt-conversation-to-project:' + projectId;
    const action = moveMenu?.submenu?.find?.((item) => item?.id === actionId);
    snapshot.moveActionAvailable = typeof action?.onSelect === 'function';
    if (${invoke ? "true" : "false"} && snapshot.moveActionAvailable) {
      await Promise.resolve(action.onSelect());
      return { ...snapshot, invoked: true };
    }
    return snapshot;
  })()`;
}

export class NativeChatgptProjectAdapter {
  constructor({
    cdpOrigin,
    discover = discoverTargets,
    choose = chooseMainTarget,
    connectionFactory = (url) => new CdpConnection(url),
    verifyAttempts = 24,
    verifyDelayMs = 250,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
  } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.verifyAttempts = verifyAttempts;
    this.verifyDelayMs = verifyDelayMs;
    this.wait = wait;
    this.moveChain = Promise.resolve();
  }

  move(request) {
    const run = this.moveChain.then(() => this.moveOne(request));
    this.moveChain = run.catch(() => {});
    return run;
  }

  async moveOne(request) {
    const { conversationId, projectId } = normalizeChatgptProjectMoveRequest(request);
    let connection;
    try {
      const target = this.choose(await this.discover(this.cdpOrigin));
      connection = this.connectionFactory(target.webSocketDebuggerUrl);
      await connection.connect();
      const preflight = await connection.evaluate(rendererLookup(conversationId, projectId));
      const decision = decideChatgptProjectMove(preflight, projectId);
      if (decision.action === "reject") throw new Error(decision.message);
      if (decision.action === "already-applied") {
        return { applied: false, alreadyApplied: true, conversationId, projectId };
      }
      const invoked = await connection.evaluate(rendererLookup(conversationId, projectId, { invoke: true }));
      if (!invoked?.invoked) throw new Error("原生 ChatGPT 项目移动动作未执行");
      for (let attempt = 0; attempt < this.verifyAttempts; attempt += 1) {
        if (attempt > 0) await this.wait(this.verifyDelayMs);
        const snapshot = await connection.evaluate(rendererLookup(conversationId, projectId));
        if (snapshot?.projectId === projectId) {
          return { applied: true, alreadyApplied: false, conversationId, projectId };
        }
      }
      throw new Error("等待 ChatGPT 项目归属更新超时");
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}

export { rendererLookup as buildNativeChatgptProjectLookupExpression };
