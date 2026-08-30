import crypto from "node:crypto";
import { httpError } from "./http-utils.mjs";

const THREAD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

export function validateRemoteMessage(input = {}) {
  const threadId = String(input.threadId || "").trim();
  const prompt = String(input.prompt || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!THREAD_ID_PATTERN.test(threadId)) throw httpError(400, "会话标识无效");
  if (!prompt) throw httpError(400, "发送内容不能为空");
  if (prompt.length > 12_000) throw httpError(413, "发送内容过长");
  const expectedDraftRevision = input.expectedDraftRevision == null ? null : String(input.expectedDraftRevision);
  if (expectedDraftRevision !== null && !/^[0-9a-f]{64}$/.test(expectedDraftRevision)) throw httpError(400, "草稿版本无效");
  return { threadId, prompt, expectedDraftRevision };
}

export class RemoteMessageService {
  constructor({ localAdapter, nativeConversationAdapter, idFactory = () => crypto.randomUUID() } = {}) {
    this.localAdapter = localAdapter;
    this.nativeConversationAdapter = nativeConversationAdapter;
    this.idFactory = idFactory;
    this.activeThreads = new Set();
  }

  async submit(input) {
    const { threadId, prompt, expectedDraftRevision } = validateRemoteMessage(input);
    if (!this.nativeConversationAdapter) throw httpError(503, "所属节点发送服务不可用");
    const task = await this.localAdapter.getTask(threadId);
    if (!task) throw httpError(404, "所属节点不存在这个会话");
    if (this.activeThreads.has(threadId)) throw httpError(409, "这个会话正在处理上一条远端消息");
    const requestId = this.idFactory();
    this.activeThreads.add(threadId);
    try {
      await this.nativeConversationAdapter.sendMessage({ threadId, prompt, expectedDraftRevision });
      return { accepted: true, requestId, threadId };
    } finally {
      this.activeThreads.delete(threadId);
    }
  }

  async readDraft(threadId) {
    return this.nativeConversationAdapter?.readDraft?.(threadId) || null;
  }
}
