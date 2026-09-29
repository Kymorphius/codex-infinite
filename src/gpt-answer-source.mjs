import { readGptTranscript } from './gpt-context-transcript.mjs';

// The newest final answer of a native Codex conversation, read from its persisted history
// (read-only). `transcriptPathOf(id)` resolves the history file inside the configured
// session roots, exactly as the GPT context tools do; commentary is never an answer.
export function createGptAnswerSource({ transcriptPathOf, readTranscript = readGptTranscript }) {
  return async function latest(conversationId) {
    const file = await transcriptPathOf(conversationId);
    if (!file) return null;
    const { messages } = await readTranscript(file, { conversationId, limit: 8, maxMessageChars: 12_000 });
    const answer = [...messages].reverse().find(message => message.role === 'assistant' && message.text);
    return answer ? { turnId: `${answer.id}`, text: answer.text, at: answer.timestamp } : null;
  };
}
