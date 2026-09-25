# Codex account usage page

## Behavior

- A dedicated Usage page shows account level quota separately from the Context Status page's per-conversation context settings.
- The module navigation exposes Usage as a top-level page adjacent to Context Status.
- For each available Codex rate limit window, show the used percentage, progress, and local reset time. Unknown or unavailable data stays unknown rather than becoming zero.
- A manual page refresh reloads usage. No dollar amount is shown: the subscription rate limit response is not a bill.

## Data boundary

- Read `account/rateLimits/read` through the local Codex App Server using this node's native Codex home.
- Normalize only the limit label, window length, used percentage, and reset timestamp before responding through the loopback GET endpoint. Do not expose account IDs, credits, authentication data, or raw App Server payloads.
- A failed usage read is isolated from the existing context override view and displays an unavailable state.

## Verification

- Test normalization for multiple windows, absent windows, invalid percentages, and missing reset timestamps.
- Test the HTTP read-only boundary and absence of account metadata.
- Run repository checks and inspect the rendered Usage page.
