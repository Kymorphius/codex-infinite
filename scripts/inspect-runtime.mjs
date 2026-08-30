import { CdpConnection, chooseMainTarget, discoverTargets } from "../src/cdp-client.mjs";

export const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function createInspectRuntime(config) {
  const targets = await discoverTargets(config.cdpOrigin);
  const target = chooseMainTarget(targets);
  const connection = new CdpConnection(target.webSocketDebuggerUrl, { commandTimeoutMs: 20000 });
  await connection.connect();

  async function evaluateInSession(sessionId, expression) {
    const result = await connection.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result?.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.description || result.exceptionDetails.text || "Runtime.evaluate failed";
      throw new Error(detail);
    }
    return result?.result?.value;
  }

  async function findDashboardIframe(attempts = 12) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const iframe = (await discoverTargets(config.cdpOrigin)).find((candidate) => candidate.type === "iframe" && candidate.url?.startsWith(`${config.dashboardOrigin}/`));
      if (iframe) return iframe;
      await wait(250);
    }
    return null;
  }

  async function waitForDashboardData() {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const ready = await connection.evaluate("Boolean(document.querySelector('[data-codex-control-console-frame-ready]'))").catch(() => false);
      if (ready) break;
      await wait(250);
    }
    const iframe = await findDashboardIframe();
    if (!iframe) return false;
    const { sessionId } = await connection.send("Target.attachToTarget", { targetId: iframe.id, flatten: true });
    try {
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const loaded = await evaluateInSession(sessionId, `(() => {
          const module = new URLSearchParams(location.search).get('module') || 'board';
          const selector = module === 'console' ? '[data-testid="console-connection-status"]' : module === 'sessions' ? '[data-testid="session-connection-status"]' : module === 'priority' ? '[data-testid="priority-connection-status"]' : '[data-testid="connection-status"]';
          const text = document.querySelector(selector)?.textContent?.trim() || '';
          return text && text !== '连接中…';
        })()`).catch(() => false);
        if (loaded) return true;
        await wait(250);
      }
      return false;
    } finally {
      await connection.send("Target.detachFromTarget", { sessionId }).catch(() => {});
    }
  }

  return { connection, evaluateInSession, findDashboardIframe, target, waitForDashboardData };
}
