# Unsent-draft mark in 最近会话 / 最近发送

## Behavior

- A row whose conversation holds an unsent composer draft shows a small pencil mark after
  its title, before any engine tag. Hovering shows `未发送的草稿：<first 80 characters>`.
- The mark is independent of the status icon: a completed, read conversation keeps its
  quiet status slot and still shows the pencil.
- The mark disappears on the next refresh after the draft is sent or cleared.

## Sources

- Native Codex threads: the app's persisted atom `composer-prompt-drafts-v2` (legacy v1
  fallback) in the owning CODEX_HOME's `.codex-global-state.json`, scope `local:<thread id>`.
  Values are plain text, `{ prompt: text }`, or `{ prompt: { document } }`; only visible
  text counts, collapsed to one line. The file is read-only and reparsed only when its
  mtime or size changes. The reader is optional decoration on the attention service: a
  failure yields no drafts and never marks the attention snapshot stale.
- The field `draft` is added to an attention status only when a draft exists, so statuses
  without drafts are unchanged.
- Terminal (Claude CLI) conversations: the page's own `sessionStorage` key
  `terminal-draft:<conversation id>` written by the native terminal composer.
- New-thread drafts (`client-new-thread:*`) have no conversation row and are ignored.

## Non-goals

- No draft preview text inside the row, only in the tooltip.
- No draft marks in the sidebar.
