import fs from 'node:fs/promises';
import { routerCompanionUrl } from './router-companion-client.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createRouterInteractionClient({ origin, callerSecretPath, fetchImpl = fetch, readFile = fs.readFile }) {
  return {
    async request({ threadId, answer } = {}) {
      if (!UUID.test(threadId || '')) throw Error('会话标识无效');
      const secret = String(await readFile(callerSecretPath, 'utf8')).trim();
      const url = new URL(routerCompanionUrl(origin, secret).replace(/claude-companions\/create$/, 'claude-interactions'));
      if (!answer) url.searchParams.set('threadId', threadId);
      let response;
      try {
        response = await fetchImpl(url, { method: answer ? 'POST' : 'GET', cache: 'no-store', redirect: 'error',
          headers: { accept: 'application/json', ...(answer ? { 'content-type': 'application/json' } : {}) },
          ...(answer ? { body: JSON.stringify({ threadId, answer }) } : {}), signal: AbortSignal.timeout(4000) });
      } catch { throw Error('Claude 交互通道暂不可用'); }
      if (!response.ok) throw Error(response.status === 409 ? '这个 Claude 请求已结束，请等待刷新' : 'Claude 交互通道暂不可用');
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 1024 * 1024) throw Error('Claude 交互响应过大');
      const value = JSON.parse(raw);
      if (answer ? value?.accepted !== true : !Array.isArray(value?.requests)) throw Error('Claude 交互响应无效');
      return value;
    },
  };
}
