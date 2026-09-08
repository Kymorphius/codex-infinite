import crypto from "node:crypto";
import { validateApprovalDecision } from "./approval-contract.mjs";
import { httpError } from "./http-utils.mjs";

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const NATIVE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateRemoteMessage(input = {}) {
  const threadId = String(input.threadId || "").trim();
  const prompt = String(input.prompt || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!THREAD_ID_PATTERN.test(threadId)) throw httpError(400, "会话标识无效");
  if (!prompt) throw httpError(400, "发送内容不能为空");
  if (prompt.length > 12_000) throw httpError(413, "发送内容过长");
  const expectedDraftRevision = input.expectedDraftRevision == null ? null : String(input.expectedDraftRevision);
  if (expectedDraftRevision !== null && !/^[0-9a-f]{64}$/.test(expectedDraftRevision)) throw httpError(400, "草稿版本无效");
  const deliveryMode = input.deliveryMode == null ? "new-turn" : String(input.deliveryMode);
  if (!["new-turn", "queue", "steer"].includes(deliveryMode)) throw httpError(400, "消息处理方式无效");
  return { threadId, prompt, expectedDraftRevision, deliveryMode };
}

export function validateRemoteDraft(input = {}) {
  const threadId = String(input.threadId || "").trim();
  const text = String(input.text ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (!THREAD_ID_PATTERN.test(threadId)) throw httpError(400, "会话标识无效");
  if (text.length > 12_000) throw httpError(413, "草稿内容过长");
  const expectedDraftRevision = input.expectedDraftRevision == null ? null : String(input.expectedDraftRevision);
  if (expectedDraftRevision !== null && !/^[0-9a-f]{64}$/.test(expectedDraftRevision)) throw httpError(400, "草稿版本无效");
  return { threadId, text, expectedDraftRevision };
}

export function validateRemoteControl(input = {}) {
  const threadId = String(input.threadId || "").trim();
  const turnId = String(input.turnId || "").trim().toLowerCase();
  if (!THREAD_ID_PATTERN.test(threadId)) throw httpError(400, "会话标识无效");
  if (!NATIVE_ID_PATTERN.test(turnId)) throw httpError(400, "执行轮次标识无效");
  if (input.action === "interrupt") return { threadId, turnId, action: "interrupt" };
  if (input.action !== "resolveApproval") throw httpError(400, "远端会话操作无效");
  const approvalToken = String(input.approvalToken || "").trim().toLowerCase();
  if (!NATIVE_ID_PATTERN.test(approvalToken)) throw httpError(400, "审批标识无效");
  let decision;
  try { decision = validateApprovalDecision(input.decision); }
  catch { throw httpError(400, "远端审批操作无效"); }
  return { threadId, turnId, action: "resolveApproval", approvalToken, decision };
}

export class RemoteMessageService {
  constructor({ localAdapter, nativeConversationAdapter, idFactory = () => crypto.randomUUID() } = {}) {
    this.localAdapter = localAdapter;
    this.nativeConversationAdapter = nativeConversationAdapter;
    this.idFactory = idFactory;
    this.activeThreads = new Set();
  }

  async submit(input) {
    const { threadId, prompt, expectedDraftRevision, deliveryMode } = validateRemoteMessage(input);
    if (!this.nativeConversationAdapter) throw httpError(503, "所属节点发送服务不可用");
    const task = await this.localAdapter.getTask(threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    if (this.activeThreads.has(threadId)) throw httpError(409, "这个会话正在处理上一条远端消息");
    const requestId = this.idFactory();
    this.activeThreads.add(threadId);
    try {
      await this.nativeConversationAdapter.sendMessage({ threadId, prompt, expectedDraftRevision, deliveryMode });
      return { accepted: true, requestId, threadId, deliveryMode, executionAuthority: "owner-native-desktop" };
    } finally {
      this.activeThreads.delete(threadId);
    }
  }

  async readDraft(threadId) {
    return this.nativeConversationAdapter?.readDraft?.(threadId) || null;
  }

  async updateDraft(input) {
    const { threadId, text, expectedDraftRevision } = validateRemoteDraft(input);
    if (!this.nativeConversationAdapter?.updateDraft) throw httpError(503, "所属节点草稿同步服务不可用");
    const task = await this.localAdapter.getTask(threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    if (this.activeThreads.has(threadId)) throw httpError(409, "这个会话正在处理另一项远端输入");
    this.activeThreads.add(threadId);
    try {
      const draft = await this.nativeConversationAdapter.updateDraft({ threadId, text, expectedDraftRevision });
      return { accepted: true, threadId, draft, executionAuthority: "owner-native-desktop" };
    } finally {
      this.activeThreads.delete(threadId);
    }
  }

  async readPendingApprovals(threadId) {
    return this.nativeConversationAdapter?.readPendingApprovals?.(threadId) || [];
  }

  async interrupt(input) {
    const { threadId, turnId, action } = validateRemoteControl(input);
    if (!this.nativeConversationAdapter?.interruptTurn) throw httpError(503, "所属节点中断服务不可用");
    const task = await this.localAdapter.getTask(threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    if (task.status !== "active") throw httpError(409, "这一轮已经不在执行中");
    await this.nativeConversationAdapter.interruptTurn({ threadId, turnId });
    return { accepted: true, interrupted: true, threadId, turnId, action, executionAuthority: "owner-native-desktop" };
  }

  async resolveApproval(input) {
    const { threadId, turnId, action, approvalToken, decision } = validateRemoteControl(input);
    if (!this.nativeConversationAdapter?.resolveApproval) throw httpError(503, "所属节点审批服务不可用");
    const task = await this.localAdapter.getTask(threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    await this.nativeConversationAdapter.resolveApproval({ threadId, turnId, approvalToken, decision });
    return { accepted: true, approvalResolved: true, threadId, turnId, action, decision, executionAuthority: "owner-native-desktop" };
  }

  async control(input) {
    const normalized = validateRemoteControl(input);
    return normalized.action === "interrupt" ? this.interrupt(normalized) : this.resolveApproval(normalized);
  }
}
