const CONVERSATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_ID_PATTERN = /^g-p-[0-9a-f]{32}$/i;

export function normalizeChatgptProjectMoveRequest({ conversationId, projectId } = {}) {
  const normalizedConversationId = String(conversationId || "").trim().toLowerCase();
  const normalizedProjectId = String(projectId || "").trim().toLowerCase();
  if (!CONVERSATION_ID_PATTERN.test(normalizedConversationId)) throw new TypeError("ChatGPT 会话标识无效");
  if (!PROJECT_ID_PATTERN.test(normalizedProjectId)) throw new TypeError("ChatGPT 项目标识无效");
  return { conversationId: normalizedConversationId, projectId: normalizedProjectId };
}

export function decideChatgptProjectMove(preflight, projectId) {
  if (!preflight?.found) return { action: "reject", message: "原生 ChatGPT 会话行尚未加载" };
  if (preflight.source !== "chatgpt" || preflight.conversationOrigin === "tpp") {
    return { action: "reject", message: "只能移动普通 ChatGPT 聊天" };
  }
  if (preflight.projectId === projectId) return { action: "already-applied" };
  if (preflight.projectId) return { action: "reject", message: "该聊天已经属于另一个 ChatGPT 项目" };
  if (!preflight.rowAvailable) return { action: "reject", message: "原生 ChatGPT 会话行尚未加载" };
  if (!preflight.moveActionAvailable) return { action: "reject", message: "原生 ChatGPT 项目移动动作不可用" };
  return { action: "move" };
}
