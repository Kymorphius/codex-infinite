# Stable session titles across Codex record versions

## Context

The session index originally derived a task title only from the rollout's first
meaningful user message. That provides a useful creation-time fallback, but it
does not reflect a title that the user later renamed in Codex desktop. Codex
persists those current names in the owning node's `session_index.jsonl`.

Some current sessions begin with transport-provided plugin, environment, browser,
or attachment context. Those records are useful to Codex but are not conversation
titles and must not appear as user-facing task names.

## Goals

- Derive the same stable title on the owning node for legacy and current rollout
  formats.
- Prefer the latest non-empty `thread_name` from the owning node's read-only
  session index so user renames remain visible.
- Prefer the first meaningful user-authored text in chronological record order.
- Ignore known transport-only context blocks and use the explicit `My request`
  portion when an attachment envelope contains one.
- Preserve the existing bounded peer contract and ID fallback.

## Non-goals

- Writing generated titles into native Codex storage.
- Reproducing Codex's private title-generation model.
- Reading another device's session files directly from the browser.

## Design

A focused session-title module normalizes candidate text. The task adapter feeds
it legacy `event_msg/user_message` values and current `response_item/message`
input-text values in record order. Empty or transport-only candidates are
skipped. The first meaningful candidate is whitespace-normalized, control
characters are removed, and the result is bounded to 160 characters.

A separate read-only title-index adapter parses `session_index.jsonl` once per
task-list refresh. The latest valid record for a thread wins. Its `thread_name`
overrides the rollout-derived fallback; a missing, malformed, or empty index
entry never hides a readable session.

The title is computed by the owning node before federation normalization. Peers
continue to receive only the normalized title and never the raw rollout path or
content.

## Acceptance criteria

- [x] Legacy user-message titles remain unchanged.
- [x] Current response-item user messages produce a title.
- [x] Plugin/environment-only records are skipped.
- [x] Attachment envelopes use their explicit user request.
- [x] Sessions without meaningful user text retain the `任务 <id>` fallback.
- [x] User-renamed Codex titles override creation-time rollout titles.
- [x] Duplicate title-index records use the latest valid name.
- [x] A missing or malformed title index safely falls back to rollout titles.
- [x] Structure checks and the full test suite pass.
