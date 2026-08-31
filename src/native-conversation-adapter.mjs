import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { httpError } from "./http-utils.mjs";
import crypto from "node:crypto";
import { normalizePendingApprovals, validateApprovalDecision } from "./approval-contract.mjs";
import { nativeThreadStatusExpression, normalizeNativeThreadStatuses } from "./native-thread-status.mjs";

const LOCAL_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function draftRevision(text) {
  const value = String(text || "").trim();
  return value ? crypto.createHash("sha256").update(value).digest("hex") : null;
}

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

function interruptTurnExpression(threadId, turnId) {
  return `(async () => {
    const interrupt = window.__codexControlConsoleInterruptThread;
    if (typeof interrupt !== 'function') return { ok: false, message: '所属节点的原生中断服务尚未就绪' };
    try {
      await interrupt(${JSON.stringify(threadId)}, ${JSON.stringify(turnId)});
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error?.message || '所属节点拒绝了中断请求').slice(0, 240) };
    }
  })()`;
}

function pendingApprovalsExpression(threadId) {
  return `(() => {
    const read = window.__codexControlConsoleReadPendingApprovals;
    if (typeof read !== 'function') return { ok: false, message: '所属节点的原生审批服务尚未就绪' };
    try { return { ok: true, items: read(${JSON.stringify(threadId)}) }; }
    catch (error) { return { ok: false, message: String(error?.message || '无法读取原生审批').slice(0, 240) }; }
  })()`;
}

function resolveApprovalExpression({ threadId, turnId, approvalToken, decision }) {
  return `(async () => {
    const resolve = window.__codexControlConsoleResolveApproval;
    if (typeof resolve !== 'function') return { ok: false, unavailable: true, message: '所属节点的原生审批服务尚未就绪' };
    try {
      const result = await resolve(${JSON.stringify(threadId)}, ${JSON.stringify(turnId)}, ${JSON.stringify(approvalToken)}, ${JSON.stringify(decision)});
      return { ok: Boolean(result?.accepted) };
    } catch (error) {
      return { ok: false, message: String(error?.message || '所属节点拒绝了审批操作').slice(0, 240) };
    }
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

  async connect() {
    const target = this.choose(await this.discover(this.cdpOrigin));
    const connection = this.connectionFactory(target.webSocketDebuggerUrl);
    await connection.connect();
    return connection;
  }

  async probe() {
    let connection;
    try {
      connection = await this.connect();
      return true;
    } catch {
      return false;
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  async readThreadStatuses() {
    let connection;
    try {
      connection = await this.connect();
      return normalizeNativeThreadStatuses(await connection.evaluate(nativeThreadStatusExpression));
    } catch {
      return new Map();
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  async readDraft(threadId) {
    if (!LOCAL_THREAD_ID.test(threadId) || this.active) return null;
    let connection;
    try {
      connection = await this.connect();
      const state = await connection.evaluate(composerStateExpression(threadId));
      if (!state?.ready || !state.draft) return null;
      return { text: state.draft, revision: draftRevision(state.draft) };
    } catch {
      return null;
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  async readPendingApprovals(threadId) {
    if (!LOCAL_THREAD_ID.test(threadId)) return [];
    let connection;
    try {
      connection = await this.connect();
      const result = await connection.evaluate(pendingApprovalsExpression(threadId.toLowerCase()));
      if (!result?.ok) return [];
      return normalizePendingApprovals(result.items, { expectedThreadId: threadId });
    } catch {
      return [];
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  async replaceDraft(connection, prompt) {
    await connection.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4 });
    await connection.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
    await connection.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
    await connection.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
    const cleared = await this.waitFor(connection, composerTextExpression, (value) => value === "");
    if (cleared === null) throw httpError(503, "无法安全更新所属节点的原生草稿");
    await connection.send("Input.insertText", { text: prompt });
  }

  async sendMessage({ threadId, prompt, expectedDraftRevision = null }) {
    if (!LOCAL_THREAD_ID.test(threadId)) throw httpError(400, "原生 Codex 会话标识无效");
    if (this.active) throw httpError(409, "所属节点正在接收另一条远端消息");
    this.active = true;
    let connection;
    try {
      connection = await this.connect();
      await connection.evaluate(openThreadExpression(threadId));
      const state = await this.waitFor(connection, composerStateExpression(threadId), (value) => value?.ready);
      if (!state) throw httpError(503, "无法在所属节点打开这个原生会话");
      const currentRevision = draftRevision(state.draft);
      if (currentRevision !== (expectedDraftRevision || null)) throw httpError(409, "所属节点的原生草稿已经变化，请同步后再发送");
      if (!await connection.evaluate(focusComposerExpression)) throw httpError(503, "无法聚焦所属节点的原生输入框");
      if (state.draft && state.draft !== prompt.trim()) await this.replaceDraft(connection, prompt);
      else if (!state.draft) await connection.send("Input.insertText", { text: prompt });
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

  async interruptTurn({ threadId, turnId }) {
    if (!LOCAL_THREAD_ID.test(threadId) || !LOCAL_THREAD_ID.test(turnId)) throw httpError(400, "原生 Codex 会话或执行轮次标识无效");
    let connection;
    try {
      connection = await this.connect();
      const result = await connection.evaluate(interruptTurnExpression(threadId.toLowerCase(), turnId.toLowerCase()));
      if (!result?.ok) throw httpError(409, result?.message || "所属节点当前无法停止这一轮");
      return { interrupted: true, threadId, turnId };
    } catch (error) {
      if (error?.statusCode) throw error;
      throw httpError(503, "所属节点的原生 Codex 中断服务不可用");
    } finally {
      await connection?.close().catch(() => {});
    }
  }


  async resolveApproval({ threadId, turnId, approvalToken, decision }) {
    if (!LOCAL_THREAD_ID.test(threadId) || !LOCAL_THREAD_ID.test(turnId) || !LOCAL_THREAD_ID.test(approvalToken)) {
      throw httpError(400, "原生 Codex 会话、执行轮次或审批标识无效");
    }
    try { decision = validateApprovalDecision(decision); }
    catch { throw httpError(400, "远端审批操作无效"); }
    let connection;
    try {
      connection = await this.connect();
      const result = await connection.evaluate(resolveApprovalExpression({
        threadId: threadId.toLowerCase(),
        turnId: turnId.toLowerCase(),
        approvalToken: approvalToken.toLowerCase(),
        decision
      }));
      if (!result?.ok) throw httpError(result?.unavailable ? 503 : 409, result?.message || "这个审批已经失效");
      return { approvalResolved: true, threadId, turnId, decision };
    } catch (error) {
      if (error?.statusCode) throw error;
      throw httpError(503, "所属节点的原生 Codex 审批服务不可用");
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}
