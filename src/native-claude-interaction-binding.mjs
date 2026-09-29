import { buildNativeClaudeInteractions } from './native-claude-interactions.mjs';
import { readNativeComposerThreadId } from './native-composer-thread-id.mjs';

export const CLAUDE_INTERACTION_BINDING = '__cccClaudeInteraction';
export function createNativeClaudeInteractionBinding(client) {
  return {
    name: CLAUDE_INTERACTION_BINDING,
    source: buildNativeClaudeInteractions(CLAUDE_INTERACTION_BINDING),
    async handle(payload, connection, { executionContextId: contextId } = {}) {
      if (!Number.isInteger(contextId) || typeof payload !== 'string' || Buffer.byteLength(payload) > 128 * 1024) return;
      let message;
      try { message = JSON.parse(payload); } catch { return; }
      if (!/^[\w-]{1,80}$/.test(message?.id || '') || !['read', 'answer'].includes(message.operation)) return;
      // Check origin AND currently mounted thread on every action, including after navigation.
      const result = await connection.send('Runtime.evaluate', { contextId, returnByValue: true,
        expression: `location.origin === 'app://-' && window === window.top && (${readNativeComposerThreadId.toString()})(document) === ${JSON.stringify(message.threadId)}` });
      if (result?.result?.value !== true) return;
      let response;
      try { response = { id: message.id, result: await client.request({ threadId: message.threadId,
        ...(message.operation === 'answer' ? { answer: message.answer } : {}) }) }; }
      catch { response = { id: message.id, error: 'Claude 请求已结束或连接暂不可用，请刷新后重试' }; }
      await connection.send('Runtime.evaluate', { contextId,
        expression: `window.__cccClaudeInteractionReceive?.(${JSON.stringify(response)})` });
    },
  };
}
