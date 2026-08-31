# Full-fidelity execution transcript

## Status

Implemented and deployed to MatrixBook Air and MacBook Pro on 2026-08-31.

## Problem

The unified remote conversation currently projects only tool name and lifecycle
status, then groups adjacent operations into counts. The owner can follow Codex
commentary but cannot inspect the exact command, tool arguments, file paths, or
result returned by the owning desktop. This makes remote supervision less useful
than the native conversation.

The console is deployed only across devices controlled by one user. The user has
explicitly chosen fidelity over execution-transcript redaction for this trusted
node group.

## Goals

- Project the exact recorded input and output of supported execution records.
- Pair tool results with their originating call by native call identifier.
- Render every operation as an individually expandable execution card.
- Preserve whitespace and content; do not mask commands, paths, output, errors,
  tokens, or other text that appears inside a tool record.
- Continue live refresh so input appears before output and the same card updates
  when the result arrives.
- Retain loopback-only HTTP, explicit owner routing, authenticated SSH transport,
  no-store responses, and ephemeral browser rendering.

## Non-goals

- Model hidden reasoning, encrypted reasoning content, system prompts, account
  token refreshes, attestation messages, or unknown native records.
- Persisting a second transcript database.
- Rendering binary media inline in this increment.
- Removing resource bounds or sending the entire historical session file.

## Contract

Activity schema version 1 keeps backward compatibility and extends each `tool`
entry with optional `callId`, `input`, `output`, `inputTruncated`, and
`outputTruncated` fields. Supported calls are `custom_tool_call`,
`function_call`, and `web_search_call`; supported results are
`custom_tool_call_output` and `function_call_output`.

String inputs and outputs keep their exact recorded characters. Non-string
values use their complete JSON representation. Result records are joined to the
earlier call with `call_id`. If a bounded file tail begins after the call, the
result remains visible as an orphan execution-result entry instead of being
dropped.

Each input or output is capped at 256 KiB and the selected recent activity is
capped at 1 MiB. A value above a bound is not silently represented as complete:
the contract carries an explicit truncation flag. The tail reader remains at 2
MiB and the SSH response limit becomes 2 MiB. These are availability bounds, not
content redaction.

Peer normalization validates every new field, exact call-id shape, aggregate
detail size, and the overall serialized response. Older nodes that omit detail
remain valid.

## UI

Consecutive tools are no longer collapsed into an operation count. Each tool is
an expandable card showing tool name, status, timestamp, and whether input or
output is available. Expanding it shows `输入` and `输出` in preformatted,
selectable text. The DOM uses `textContent`; recorded HTML is never interpreted.

Cards remain collapsed by default so long conversations stay readable. Their
open state survives live reconciliation through the existing stable entry key.
In-progress calls update in place when their output record arrives.

## Trust and privacy boundary

Execution input and output may contain passwords, API keys, environment values,
private source, or personal data. That content is deliberately visible to the
user's other configured nodes and loopback dashboard. The console does not try
to detect or mask it.

Infrastructure credentials remain out of scope: SSH private keys, node signing
keys, Codex authentication stores, cookies, and credential files are never read
for this projection. Hidden reasoning and authentication protocol messages stay
excluded. Mirrored activity is not persisted and uses `Cache-Control: no-store`.

## Verification evidence

- `npm run check` passed across 148 files with zero frozen structural debt.
- All 173 tests passed, including exact whitespace/content preservation, paired
  and orphan results, UTF-8 truncation, peer bounds, ungrouped presentation,
  stable identity, and HTML-as-text rendering.
- MatrixBook Air read the MacBook Pro `自动驾驶` conversation through
  `direct-ssh`: 40 inspected operations had both exact input and output paired
  to 40 distinct call identifiers.
- The live dark UI rendered 41 individual execution cards. Expanding a card
  showed non-empty `输入` and `输出` preformatted blocks; its open state survived
  a three-second activity refresh.
- MacBook Pro read the active MatrixBook Air console conversation through
  `direct-ssh`: 38 calls had input while 37 had output, confirming that an
  in-flight call is visible before its result arrives.

## Rollback

Stop projecting tool detail and restore grouped tool summaries. Native owner
conversation data remains unchanged because this feature is read-only.
