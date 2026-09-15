# Native UI performance stabilization

## Problem

The enhanced Windows client can become visibly unresponsive on large Codex pages. The injected conversation tabs and turn-annotation controls react to broad DOM mutation and scroll streams. Their refresh paths repeatedly scan the document and read layout geometry, which forces synchronous layout work. A missing primary native bridge also retries and logs at a fixed short interval.

## Required behavior

- Coalesce native conversation-tab synchronization and positioning so ordinary DOM mutation bursts cannot run the full layout scan more than a few times per second.
- Preserve immediate positioning for explicit renders, route changes, and window resize.
- Read each candidate element's geometry at most once during one tab-positioning pass, and reuse the workspace candidate and rectangle across that pass.
- Coalesce turn-annotation mutation and scroll refreshes through animation-frame scheduling.
- Do not refresh turn annotations when bridge snapshots repeat the same presentation and annotation state.
- Reuse an attached output card instead of searching every button on every annotation refresh.
- Back off primary-bridge polling after consecutive failures and reset to the configured poll interval after recovery.
- Preserve all existing safety boundaries: exact native target selection, loopback bridge origins, local-only annotation storage, and no dashboard fallback for primary-owned writes.

## Verification

- Generated-injection regression tests assert that broad observers use the coalesced paths and repeated bridge snapshots have no-op guards.
- Primary-owner injector tests assert capped exponential retry delay and reset after a successful sync.
- `npm run check` and `npm test` pass.
- On Windows, the installed client renders its native controls and a four-second live measurement shows materially fewer long tasks and lower event-loop delay than the pre-fix baseline.
