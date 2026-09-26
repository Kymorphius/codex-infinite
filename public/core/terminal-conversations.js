export async function terminalConversationRequest(operation, input = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`/api/terminal-conversations/${operation}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.message || '会话操作未完成');
  return value;
}

export function openManagedTerminal(conversation, windowRef = window) {
  const reference = { provider: 'terminal', conversationId: conversation.id, deviceId: conversation.deviceId };
  if (windowRef.parent && windowRef.parent !== windowRef) {
    windowRef.parent.postMessage({ type: 'codex-control-console-open-terminal-conversation', reference }, 'app://-');
  } else {
    const url = new URL('/', windowRef.location.href);
    url.searchParams.set('module', 'terminal'); url.searchParams.set('view', 'conversation');
    url.searchParams.set('conversationId', conversation.id);
    windowRef.location.assign(url.href);
  }
}
