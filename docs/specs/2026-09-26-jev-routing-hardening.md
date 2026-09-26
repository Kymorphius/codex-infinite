# Jev routing correctness and efficiency

## Observable contract

- Router classifies an interactive turn once. Tool-result requests and concurrent retries with the same thread and turn IDs reuse its selected model, effort, tier, and exact-turn receipt. A new turn may classify again.
- Jev receives a bounded task context: the current textual user request and, for short contextual follow-ups, available recent conversational text. An image-only turn never reuses an older user request as if it were current.
- A previous tier may carry into an explicit confirmation/continuation, with receipt source marked as inherited. A reliable six-dimension classification of a new task is not overridden solely because its Jev tier confidence was low.
- Six-dimension routing requires confidence in the dimensions that materially determine an escalation. Confidence threshold comparisons are stable at exact decimal boundaries. Tier-to-model/effort mappings remain user-controlled and shared.
- If Jev exits before consuming stdin, both clients treat the failure as a bounded classification failure; the process remains alive and chooses the configured fallback.
- In native transport, an existing conversation's composer send is classified before the native send, applies model and effort, then releases the original send exactly once. Router transport never intercepts the composer. New-chat behavior must not display a routed model unless it can apply it.
- Identical routing snapshots do not rewrite local turn history, and merging up to 512 receipts is linear in receipt count.

## Verification

Use local, deterministic child-process and native-renderer fixtures for success, timeout/failure, click/Enter, same-turn replay/concurrency, mode bypass, and unchanged snapshots. Keep real Jev requests and production user messages out of tests. Confirm the running Router and enhanced console after a safe restart without interrupting active turns.
