# Copy remote conversation IDs

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-02

## Goal

Every remote conversation row in the injected native sidebar exposes a context
menu action named “复制会话 ID”. The copied value is the exact normalized remote
thread ID already used to open that conversation, with no label, URL prefix, or
display-title text.

## Behavior and safety

- Copying is available while the owning device is online or offline because it
  is a local clipboard operation over already-projected bounded metadata.
- The Clipboard API is preferred and a selected-text fallback is used when the
  native page denies Clipboard API access.
- A short native-styled “会话 ID 已复制” confirmation is shown after success.
- Copying never opens, sends to, or mutates the remote conversation.
- Project rows keep their existing project-copy menu so project identity and
  conversation identity are not conflated.

## Acceptance criteria

- Right-clicking a remote conversation shows “复制会话 ID”.
- The clipboard receives only the exact thread ID.
- The menu follows the existing dismissal, focus, and native visual behavior.
- Syntax, structure, and complete tests pass.
