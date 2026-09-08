import { CdpConnection, chooseMainTarget, discoverTargets } from "./cdp-client.mjs";
import { httpError } from "./http-utils.mjs";
import crypto from "node:crypto";
import { normalizePendingApprovals, validateApprovalDecision } from "./approval-contract.mjs";
import { nativeThreadStatusExpression, normalizeNativeThreadStatuses } from "./native-thread-status.mjs";

const LOCAL_THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function draftRevision(text) {
  const value = canonicalDraftText(text);
  return value ? crypto.createHash("sha256").update(value).digest("hex") : null;
}

export function canonicalDraftText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).filter((line) => line.trim()).join("\n").trim();
}

function sameDraftText(left, right) {
  return canonicalDraftText(left) === canonicalDraftText(right);
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

function submitComposerExpression(deliveryMode) {
  return `(() => {
  const editor = document.querySelector('[data-codex-composer="true"][contenteditable="true"]');
  if (!editor) return { ok: false };
  let root = editor;
  const labels = {
    "new-turn": ["发送", "Send"],
    steer: ["调整方向", "Steer", "引導"],
    queue: ["加入队列", "Queue", "加入佇列"]
  };
  let button = null;
  let action = null;
  while (root && !button) {
    for (const candidate of root.querySelectorAll('button[aria-label]')) {
      const label = candidate.getAttribute('aria-label');
      for (const [kind, values] of Object.entries(labels)) if (values.includes(label)) { button = candidate; action = kind; break; }
      if (button) break;
    }
    root = root.parentElement;
  }
  if (!button || button.disabled) return { ok: false };
  const desired = ${JSON.stringify(deliveryMode)};
  if (action === desired) { button.click(); return { ok: true, inverted: false, action }; }
  if (["queue", "steer"].includes(action) && ["queue", "steer"].includes(desired)) return { ok: true, inverted: true, action };
  return { ok: false, action };
})()`;
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class NativeConversationAdapter {
  constructor({ cdpOrigin, platform = process.platform, timeoutMs = 5_000, pollMs = 50, discover = discoverTargets, choose = chooseMainTarget, connectionFactory = (url) => new CdpConnection(url) } = {}) {
    this.cdpOrigin = cdpOrigin;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.discover = discover;
    this.choose = choose;
    this.connectionFactory = connectionFactory;
    this.selectAllModifiers = platform === "win32" ? 2 : 4;
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

  async readThreadStatuses({ strict = false } = {}) {
    let connection;
    try {
      connection = await this.connect();
      const items = await connection.evaluate(nativeThreadStatusExpression);
      if (strict && !Array.isArray(items)) throw new Error("Native runtime status unavailable");
      return normalizeNativeThreadStatuses(items);
    } catch (error) {
      if (strict) throw error;
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
    await connection.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: this.selectAllModifiers });
    await connection.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: this.selectAllModifiers });
    await connection.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
    await connection.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
    const cleared = await this.waitFor(connection, composerTextExpression, (value) => value === "");
    if (cleared === null) throw httpError(503, "无法安全更新所属节点的原生草稿");
    if (prompt) await connection.send("Input.insertText", { text: prompt });
  }

  async submitComposer(connection, deliveryMode) {
    const submission = await connection.evaluate(submitComposerExpression(deliveryMode));
    if (!submission?.ok) return false;
    if (!submission.inverted) return true;
    const modifiers = this.selectAllModifiers | 8;
    await connection.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers });
    await connection.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers });
    return true;
  }

  async updateDraft({ threadId, text, expectedDraftRevision = null }) {
    if (!LOCAL_THREAD_ID.test(threadId)) throw httpError(400, "原生 Codex 会话标识无效");
    let connection;
    try {
      connection = await this.connect();
      await connection.evaluate(openThreadExpression(threadId));
      const state = await this.waitFor(connection, composerStateExpression(threadId), (value) => value?.ready);
      if (!state) throw httpError(503, "无法在所属节点打开这个原生会话");
      const currentRevision = draftRevision(state.draft);
      if (currentRevision !== (expectedDraftRevision || null)) throw httpError(409, "所属节点的原生草稿已经变化，请先处理两端草稿冲突");
      if (sameDraftText(state.draft, text)) return text ? { text, revision: draftRevision(text) } : null;
      if (!await connection.evaluate(focusComposerExpression)) throw httpError(503, "无法聚焦所属节点的原生输入框");
      if (state.draft) await this.replaceDraft(connection, text);
      else if (text) await connection.send("Input.insertText", { text });
      const updated = await this.waitFor(connection, composerTextExpression, (value) => sameDraftText(value, text));
      if (updated === null) throw httpError(503, "无法确认所属节点的原生草稿已更新");
      return text ? { text, revision: draftRevision(text) } : null;
    } catch (error) {
      if (error?.statusCode) throw error;
      throw httpError(503, "所属节点的原生 Codex 草稿服务不可用");
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  async sendMessage({ threadId, prompt, expectedDraftRevision = null, deliveryMode = "new-turn" }) {
    if (!LOCAL_THREAD_ID.test(threadId)) throw httpError(400, "原生 Codex 会话标识无效");
    if (!["new-turn", "queue", "steer"].includes(deliveryMode)) throw httpError(400, "原生消息处理方式无效");
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
      if (state.draft && !sameDraftText(state.draft, prompt.trim())) await this.replaceDraft(connection, prompt);
      else if (!state.draft) await connection.send("Input.insertText", { text: prompt });
      const inserted = await this.waitFor(connection, composerTextExpression, (value) => sameDraftText(value, prompt.trim()));
      if (inserted === null) throw httpError(503, "原生输入框没有接收到完整内容");
      if (!await this.submitComposer(connection, deliveryMode)) throw httpError(503, deliveryMode === "new-turn" ? "原生 Codex 暂时不能发送这条消息" : "原生 Codex 暂时不能处理这条运行中消息");
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
