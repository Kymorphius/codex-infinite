# Terminal conversation shortcuts

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-28
- Related ADRs: 0029

## Problem

The 消息搜索 / 最近会话 / 最近发送 shortcut bar is positioned against the native
ChatGPT composer. The native terminal view hides that composer, so the bar
disappears inside Claude CLI conversations. Its three functions also only knew
native Codex conversations:

- 最近会话 labelled terminal tabs as 本地会话.
- 最近发送 and 消息搜索 read only native Codex session files.

Claude CLI resumes a session by copying its full history into a new transcript
and appending `{"type":"continued-in","continuedInSessionId":…}` to the old one.
The console only read the managed UUID's original file, so titles, send times
and messages after the first resume were invisible to it.

## Goals

- Inside a terminal conversation the shortcut bar sits above the terminal
  composer, with the same width inset and surface as on native pages. The
  terminal view reserves its row. The composer's key hint line is removed.
- 最近会话 labels terminal entries `Claude CLI` or `Shell` and opens them through
  the terminal provider.
- 最近发送 merges Claude CLI conversations by the time of their latest genuine
  user message with native entries; selecting one opens the terminal view.
- 消息搜索 includes messages you sent in managed Claude CLI conversations; a
  result opens the terminal view.
- Transcript reads follow `continued-in` to the most recently modified existing
  continuation file.

## Non-goals

- Shell conversations have no transcript and do not appear in 最近发送 or 消息搜索.
- No full-text index for Claude transcripts; search scans the bounded
  resolved files of managed Claude records on each query.
- Native Codex behaviour and data are unchanged.

## Contracts and data

- Presented terminal records gain optional `lastUserMessageAt` (ISO string, Claude
  records only). Stored registry records are unchanged.
- `TerminalConversationService.searchSent(query)` returns
  `{ items: [{ kind: 'terminal', id, deviceId, title, excerpt, at }], incomplete }`.
  The sent-message search response merges these with native items (native items
  keep their shape and implicit `local` kind), newest first, still capped at 30.
- A genuine user message is a `type: "user"` record for the resolved session with
  string content or text parts, not `isMeta`, no `toolUseResult`, and text not
  starting with `<` (command and system wrappers).

## Design and ownership

- `src/claude-transcript.mjs` owns locating a managed transcript inside the real
  `~/.claude/projects` root, following `continued-in` (bounded depth and count,
  realpath-contained, no symlink escape), incremental summary state (titles,
  last user time) and per-query message search. It never reads Claude settings or
  credentials.
- `src/terminal-conversation-service.mjs` projects titles and `lastUserMessageAt`
  and exposes `searchSent`.
- `src/sent-message-search-composite.mjs` merges native and terminal search results;
  `src/main.mjs` only wires it.
- Browser: `native-conversation-shortcut-layout.mjs` uses the terminal view's
  composer as its anchor when present; `native-recent-sent-conversations.mjs`,
  `native-recent-conversations.mjs` and `native-sent-message-search.mjs` route
  terminal entries to `__codexControlConsoleOpenTerminalConversation`.

## Verification

Unit tests cover continuation resolution and containment, genuine-message
filtering, incremental summaries, search merging and ordering, the terminal
anchor, recent-sent merging and terminal routing. Visual check in the running
macOS app: the bar above the CLI composer, and each menu opening a CLI entry.
