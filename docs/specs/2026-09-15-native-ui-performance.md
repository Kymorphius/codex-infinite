# Native UI performance stabilization

## Problem

The enhanced Windows client can become visibly unresponsive on large Codex pages. The injected conversation tabs and turn-annotation controls react to broad DOM mutation and scroll streams. Their refresh paths repeatedly scan the document and read layout geometry, which forces synchronous layout work. A missing primary native bridge also retries and logs at a fixed short interval.

## Required behavior

- Coalesce native conversation-tab synchronization and positioning so ordinary DOM mutation bursts cannot run the full layout scan more than a few times per second.
- Preserve immediate positioning for explicit renders, route changes, and window resize.
- Read each candidate element's geometry at most once during one tab-positioning pass, and reuse the workspace candidate and rectangle across that pass.
- Reuse the discovered native top controls between ordinary mutation refreshes. A fresh scan is required on route or window-size changes and is otherwise limited to once per second; when scanning, filter by geometry before reading computed styles so offscreen buttons avoid that extra layout work.
- Native sidebar projections must ignore mutations caused solely by their own render cycle, so inserting a projection cannot schedule an endless sequence of animation-frame renders. Project expiry uses one timer for its next known deadline, rather than polling every second.
- Turn annotations must be event-driven after an initial delayed reconciliation; no permanent one-second document refresh is permitted while the enhanced client is idle.
- Sending a native message is latency-critical. Turbo context preparation starts proactively when a thread or policy becomes active and is deduplicated by thread plus desired context. A prepared thread sends synchronously; a still-preparing thread awaits that same preparation exactly once. Preparation failure must reject the send and preserve the draft rather than silently falling back. Renderer-side Jev routing is never awaited, while model, reasoning, service tier, permission, and context enhancements remain authoritative.
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
