import path from 'node:path';
import { httpError } from './http-utils.mjs';
import { DiscussionService } from './discussion-service.mjs';
import { DiscussionStore } from './discussion-store.mjs';
import { createClaudeAnswerSource } from './claude-answer-source.mjs';
import { createGptAnswerSource } from './gpt-answer-source.mjs';

const PASTE_START = '\x1b[200~', PASTE_END = '\x1b[201~';

// Claude side: a managed terminal conversation. Text goes to its running PTY exactly like
// the composer's paste + Enter; nothing is sent to a conversation that is stopped, held by
// another process, or mid-reply, so a forward never interleaves with Claude's own output.
export function createClaudeParticipant({ terminalConversations, terminalService, userHome, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const record = id => terminalConversations.store.get(id).catch(() => null);
  const sessionIds = async id => {
    const summary = await terminalConversations.claudeTranscripts.summary(id).catch(() => null);
    return [...new Set([summary?.resumeId, ...(summary?.ids || []), id].filter(Boolean))];
  };
  return {
    resolve: async id => { const found = await record(id); return found?.kind === 'claude' ? { cwd: found.cwd, title: found.title } : null; },
    latestAnswer: createClaudeAnswerSource({ userHome, sessionIds }),
    deliver: async (id, text) => {
      const found = await record(id);
      if (!found) throw httpError(404, 'Claude 会话不存在');
      const view = await terminalConversations.view(found);
      if (view.status !== 'running' || !view.runtimeSessionId) throw httpError(409, 'Claude 会话没有在运行，请先打开它');
      if (view.claudeStatus === 'busy') throw httpError(409, 'Claude 正在回复，等它结束后再转发');
      const { pty } = terminalService.get(view.runtimeSessionId);
      pty.write(`${PASTE_START}${text}${PASTE_END}`);
      await delay(150); // let Claude finish the paste before Enter submits it
      pty.write('\r');
    },
  };
}

// GPT side: a native Codex conversation. Delivery uses the same owner-native send path as
// remote messages; "queue" starts a new turn when idle and queues behind a running one.
export function createGptParticipant({ localAdapter, remoteMessageService, transcriptPathOf }) {
  return {
    resolve: async id => { const task = await localAdapter.getTask(id).catch(() => null); return task ? { cwd: task.cwd, title: task.title } : null; },
    latestAnswer: createGptAnswerSource({ transcriptPathOf }),
    deliver: async (id, text) => { await remoteMessageService.submit({ threadId: id, prompt: text, deliveryMode: 'queue' }); },
  };
}

export function createDiscussionRuntime({ config, terminalConversations, terminalService, localAdapter, remoteMessageService, catalog }) {
  const transcriptPathOf = async id => {
    const item = (await catalog.snapshot()).conversations.find(entry => entry.id === id && !entry.internal);
    return item ? catalog.transcriptPath(item) : null;
  };
  return new DiscussionService({
    store: new DiscussionStore({ filePath: path.join(config.wrapperCodexHome, 'discussions.json'), deviceId: config.nodeDevice.id }),
    participants: {
      claude: createClaudeParticipant({ terminalConversations, terminalService, userHome: config.userHome }),
      gpt: createGptParticipant({ localAdapter, remoteMessageService, transcriptPathOf }),
    },
  });
}
