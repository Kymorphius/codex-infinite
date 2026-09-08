import { userTextFromSessionRecord } from './session-title.mjs';

function delegated(text) {
  return /^<codex_delegation>\s*<source_thread_id>\s*[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\s*<\/source_thread_id>\s*<input>[\s\S]*<\/input>\s*<\/codex_delegation>$/i.test(String(text || '').trim());
}

export function inputSourceFromSessionRecord(record) {
  const p = record?.payload;
  if (!p) return null;
  const item = record.type === 'event_msg' && p.type === 'item_completed' ? p.item : record.type === 'response_item' ? p : null;
  if (item && ['function_call_output', 'FunctionCallOutput', 'custom_tool_call_output', 'CustomToolCallOutput'].includes(item.type)) {
    return item.namespace === 'codex_app' && ['create_thread', 'send_message_to_thread'].includes(item.name) && delegated(item.output) ? 'codex' : null;
  }
  const kinds = p.internal_chat_message_metadata_passthrough?.content_item_kinds;
  if (Array.isArray(kinds) && !kinds.some(kind => kind.startsWith('user.'))) return null;
  const text = userTextFromSessionRecord(record);
  if (!text || text.startsWith('# AGENTS.md instructions')) return null;
  return delegated(text) ? 'codex' : 'user';
}
