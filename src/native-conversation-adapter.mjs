import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { httpError } from "./http-utils.mjs";

const LOCAL_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function openThreadExpression(threadId) {
  return `(() => {
    window.__codexControlConsoleClose?.();
    window.postMessage({ type: "navigate-to-route", path: "/local/${threadId}" }, "*");
    return true;
  })()`;
}

function composerStateExpression(threadId) {
  return `(() => {
    const selected = document.querySelector('[data-app-action-sidebar-thread-id="local:${threadId}"][data-app-action-sidebar-thread-selected="true"]');
    const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
    if (!selected || !editor || !(editor.offsetWidth || editor.offsetHeight)) return { ready: false };
    return { ready: true, draft: (editor.innerText || editor.textContent || "").trim() };
  })()`;
}

const focusComposerExpression = `(() => {
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  if (!editor || !(editor.offsetWidth || editor.offsetHeight)) return false;
  editor.focus();
  return document.activeElement === editor;
})()`;

const composerTextExpression = `(() => {
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  return editor ? (editor.innerText || editor.textContent || "").trim() : null;
})()`;

const clickSendExpression = `(() => {
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  if (!editor) return false;
  let root = editor;
  let send = null;
  while (root && !send) {
    send = Array.from(root.querySelectorAll('button')).find((button) => ["发送", "Send"].includes(button.getAttribute("aria-label")));
    root = root.parentElement;
  }
  if (!send || send.disabled) return false;
  send.click();
  return true;
})()`;

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NativeConversationAdapter {
  constructor({ cdpOrigin, timeoutMs = 5_000, pollMs = 50, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.active = false;
  }

  async waitFor(connection, expression, predicate = Boolean) {
    const deadline = Date.now() + this.timeoutMs;
    do {
      const value = await connection.evaluate(expression);
      if (predicate(value)) return value;
      await pause(this.pollMs);
    } while (Date.now() < deadline);
    return null;
  }

  async sendMessage({ threadId, prompt }) {
    if (!LOCAL_THREAD_ID.test(threadId)) throw httpError(400, "原生 Codex 会话标识无效");
    if (this.active) throw httpError(409, "所属节点正在接收另一条远端消息");
    this.active = true;
    let connection;
    try {
      const target = this.choose(await this.discover(this.cdpOrigin));
      connection = this.connectionFactory(target.webSocketDebuggerUrl);
      await connection.connect();
      await connection.evaluate(openThreadExpression(threadId));
      const state = await this.waitFor(connection, composerStateExpression(threadId), (value) => value?.ready);
      if (!state) throw httpError(503, "无法在所属节点打开这个原生会话");
      if (state.draft) throw httpError(409, "所属节点的原生输入框中有尚未发送的内容");
      if (!await connection.evaluate(focusComposerExpression)) throw httpError(503, "无法聚焦所属节点的原生输入框");
      await connection.send("Input.insertText", { text: prompt });
      const inserted = await this.waitFor(connection, composerTextExpression, (value) => value === prompt.trim());
      if (inserted === null) throw httpError(503, "原生输入框没有接收到完整内容");
      if (!await connection.evaluate(clickSendExpression)) throw httpError(503, "原生 Codex 暂时不能发送这条消息");
      const cleared = await this.waitFor(connection, composerTextExpression, (value) => value === "");
      if (cleared === null) throw httpError(503, "无法确认原生 Codex 已接收消息");
      return { accepted: true, threadId };
    } catch (error) {
      if (error?.statusCode) throw error;
      throw httpError(503, "所属节点的原生 Codex 界面不可用");
    } finally {
      await connection?.close().catch(() => {});
      this.active = false;
    }
  }
}
