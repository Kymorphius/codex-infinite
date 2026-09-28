import fs from 'node:fs/promises';
import { terminalError } from './terminal-contract.mjs';

const SECRET = /^[A-Za-z0-9_-]{32,}$/u;

// Router's caller-authenticated "create a companion Claude session for this Codex thread".
// Loopback only; the caller secret is read per request and never leaves this process.
export function routerCompanionUrl(origin, secret) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || !['', '/'].includes(url.pathname)) {
    throw terminalError(503, 'Router 地址必须是 127.0.0.1 HTTP origin');
  }
  if (!SECRET.test(secret)) throw terminalError(503, 'Router 调用凭证缺失或无效');
  return `${url.origin}/_codex-router/${secret}/v1/claude-companions/create`;
}

export function createRouterCompanionClient({ origin, callerSecretPath, fetchImpl = fetch, readFile = fs.readFile, timeoutMs = 360000 }) {
  return {
    // One tool-less Claude turn on the subscription runs inside Router; allow it minutes.
    async create(threadId) {
      const secret = String(await readFile(callerSecretPath, 'utf8').catch(() => '')).trim();
      let response;
      try {
        response = await fetchImpl(routerCompanionUrl(origin, secret), { method: 'POST', cache: 'no-store',
          headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ threadId }), signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) { throw error.statusCode ? error : terminalError(503, 'Router 不可用，未能创建伴生 Claude 会话'); }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw terminalError([400, 404, 409, 503].includes(response.status) ? response.status : 502, String(body?.error?.message || 'Router 未能创建伴生 Claude 会话').slice(0, 300));
      if (!/^[0-9a-f-]{36}$/iu.test(body?.sessionId || '')) throw terminalError(502, 'Router 返回的伴生会话无效');
      return { sessionId: body.sessionId.toLowerCase(), created: body.created === true };
    },
  };
}
