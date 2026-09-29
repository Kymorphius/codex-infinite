import { discussionActions } from './discussion-actions.mjs';

export const NATIVE_DISCUSSION_BINDING = '__codexControlConsoleDiscussionBridge';
const MAX_PAYLOAD_BYTES = 16 * 1024;
const TRUSTED_PAGE = "location.origin === 'app://-' && window === window.top";

// The page bridge can make the console type into a model conversation, so it obeys the
// same rule as the terminal bridge: only the top frame of the native app page may call it.
// The verdict is cached per execution context; a navigation creates a new context.
export function createNativeDiscussionBinding(service) {
  const actions = discussionActions(service), trusted = new Map();
  const isTrusted = async (connection, contextId) => {
    if (trusted.get(contextId) === true) return true;
    const result = await connection.send('Runtime.evaluate', { expression: TRUSTED_PAGE, contextId, returnByValue: true });
    if (result?.result?.value !== true) return false;
    trusted.set(contextId, true); return true;
  };
  async function handle(payload, connection, params = {}) {
    const contextId = params.executionContextId;
    if (!Number.isInteger(contextId) || typeof payload !== 'string' || Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) return null;
    let message;
    try { message = JSON.parse(payload); } catch { return null; }
    if (!message || typeof message !== 'object' || !/^[\w-]{1,80}$/u.test(message.id || '')
        || typeof message.operation !== 'string' || !Object.hasOwn(actions, message.operation)) return null;
    if (!(await isTrusted(connection, contextId).catch(() => false))) return null;
    let response;
    try { response = { id: message.id, ok: true, result: await actions[message.operation](message.input ?? {}) }; }
    catch (error) { response = { id: message.id, ok: false, message: String(error?.message || '协作讨论操作失败').slice(0, 200) }; }
    await connection.send('Runtime.evaluate', { expression: `window.__codexControlConsoleResolveDiscussion?.(${JSON.stringify(response)})`, contextId });
    return response;
  }
  return { name: NATIVE_DISCUSSION_BINDING, handle };
}

// Page side: `window.__cccDiscussions.request(operation, input)` -> Promise of the result.
export function installNativeDiscussionClient(bindingName) {
  const VERSION = '2026-09-29.discussion';
  if (window.__cccDiscussions?.version === VERSION) return window.__cccDiscussions;
  const pending = new Map(); let sequence = 0;
  window.__codexControlConsoleResolveDiscussion = (response) => {
    const waiter = pending.get(String(response?.id || ''));
    if (!waiter) return false;
    pending.delete(String(response.id)); clearTimeout(waiter.timeout);
    if (response.ok) waiter.resolve(response.result); else waiter.reject(new Error(response.message || '协作讨论操作失败'));
    return true;
  };
  const request = (operation, input = {}) => new Promise((resolve, reject) => {
    const bridge = window[bindingName];
    if (typeof bridge !== 'function') return reject(new Error('协作讨论桥不可用'));
    const id = 'discussion-' + Date.now() + '-' + (++sequence);
    // Forwarding to Claude may wait on the paste delay; give the host room before giving up.
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('协作讨论请求超时，请核对会话后重试')); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    try { bridge(JSON.stringify({ id, operation, input })); } catch (error) { clearTimeout(timeout); pending.delete(id); reject(error); }
  });
  return window.__cccDiscussions = { version: VERSION, request };
}

export function buildNativeDiscussionClientSource() {
  return `(${installNativeDiscussionClient.toString()})(${JSON.stringify(NATIVE_DISCUSSION_BINDING)});`;
}
