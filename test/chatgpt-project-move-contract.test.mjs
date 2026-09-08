import test from "node:test";
import assert from "node:assert/strict";
import { decideChatgptProjectMove, normalizeChatgptProjectMoveRequest } from "../src/chatgpt-project-move-contract.mjs";

const conversationId = "6a7aa82f-d580-83ea-86a0-67d64269d4e5";
const projectId = "g-p-6a7aad520e408191bf0633cb7976dace";

test("ChatGPT project move request normalizes exact native identifiers", () => {
  assert.deepEqual(normalizeChatgptProjectMoveRequest({ conversationId: conversationId.toUpperCase(), projectId: projectId.toUpperCase() }), {
    conversationId,
    projectId
  });
  assert.throws(() => normalizeChatgptProjectMoveRequest({ conversationId: "bad", projectId }), /会话标识无效/);
  assert.throws(() => normalizeChatgptProjectMoveRequest({ conversationId, projectId: "project-name" }), /项目标识无效/);
});

test("ChatGPT project move policy rejects cloud work and version drift", () => {
  assert.deepEqual(decideChatgptProjectMove({ found: true, source: "codex", conversationOrigin: "tpp", projectId: null, rowAvailable: true, moveActionAvailable: true }, projectId), {
    action: "reject", message: "只能移动普通 ChatGPT 聊天"
  });
  assert.deepEqual(decideChatgptProjectMove({ found: true, source: "chatgpt", conversationOrigin: null, projectId: null, rowAvailable: true, moveActionAvailable: false }, projectId), {
    action: "reject", message: "原生 ChatGPT 项目移动动作不可用"
  });
  assert.deepEqual(decideChatgptProjectMove({ found: true, source: "chatgpt", conversationOrigin: null, projectId: null, rowAvailable: false, moveActionAvailable: false }, projectId), {
    action: "reject", message: "原生 ChatGPT 会话行尚未加载"
  });
});

test("ChatGPT project move policy is idempotent and refuses reassignment", () => {
  assert.deepEqual(decideChatgptProjectMove({ found: true, source: "chatgpt", conversationOrigin: null, projectId, rowAvailable: true, moveActionAvailable: false }, projectId), {
    action: "already-applied"
  });
  assert.deepEqual(decideChatgptProjectMove({ found: true, source: "chatgpt", conversationOrigin: null, projectId: "g-p-6a7cb53bf8a081919818887c14e9dca0", rowAvailable: true, moveActionAvailable: true }, projectId), {
    action: "reject", message: "该聊天已经属于另一个 ChatGPT 项目"
  });
});
