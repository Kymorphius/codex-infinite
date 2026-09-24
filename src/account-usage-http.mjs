import { sendJson } from './http-utils.mjs';

export function createAccountUsageHttpHandler({ reader }) {
  return async (request, response, url) => {
    if (url.pathname !== '/api/account-usage') return false;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { status: 'error', message: 'Method not allowed' });
      return true;
    }
    try {
      sendJson(response, 200, { status: 'ok', ...await reader.read() });
    } catch {
      sendJson(response, 503, { status: 'error', message: 'Codex 账号用量暂时不可读取' });
    }
    return true;
  };
}
