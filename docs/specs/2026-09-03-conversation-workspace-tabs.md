# Conversation workspace tabs

- Status: implemented; standalone fallback retained
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADRs: none

## Problem

Opening a remote conversation replaces the whole console with a fixed reader.
Only one conversation can be represented at a time, and the fixed layer covers
the existing feature navigation. Users cannot see which conversations they have
opened, switch among them directly, or return through a persistent top-level
control.

## Goals

- Add a Chrome-style top workspace bar that always remains above console and conversation views.
- Keep one permanent Console tab and add one tab per opened remote conversation.
- Reuse an existing tab when the same device-owned conversation is opened again.
- Support activating and closing conversation tabs without closing the underlying native conversation.
- Keep the existing module tabs as secondary feature navigation below the console title.

## Non-goals

- Replacing native Codex tabs or changing how local conversations open natively.
- Persisting open tabs across process or page reloads.
- Running multiple conversation readers or refresh loops simultaneously.
- Closing, archiving, interrupting, or deleting a native conversation when its UI tab closes.

## User experience

The first row resembles a browser tab strip. “控制台” is permanent. Opening a
remote conversation adds a labeled tab and activates it; opening the same
conversation focuses the existing tab. Selecting another conversation switches
the single reader to that conversation. The close button removes only that UI
tab, selecting its right neighbor, left neighbor, or Console in that order.
Selecting Console or pressing Escape returns to the console without discarding
other open tabs. The strip scrolls horizontally when necessary.

The existing feature tabs remain below the page title. They continue to switch
the six console modules and retain their keyboard navigation.

## Contracts and data

Open-tab state is ephemeral browser memory containing only normalized task
objects already present in the dashboard. A tab identity is the exact tuple of
owning device ID and conversation ID. HTTP, persisted data, URL, task, and
parent-frame contracts are unchanged.

## Design and ownership

`public/features/sessions/conversation-tabs.js` owns the ephemeral tab state and
DOM interaction. `public/features/sessions/index.js` composes it with the existing
single remote conversation reader. `remote-conversation.js` remains responsible
for content, refresh, drafts, settings, and controls, and exposes view open/close
operations to the session feature. The static HTML and shared theme styles own
the global strip presentation.

## Security and privacy

No new data leaves the dashboard. Tab labels are rendered with `textContent`.
Device ownership remains part of the identity and all reads and mutations retain
their existing owner-routed and exact-origin boundaries. Closing a UI tab is
non-destructive.

## Rollout and rollback

The behavior activates with the dashboard shell. Remove the workspace-tab
controller, shell markup, and reader top inset to restore the single-reader
overlay. No migration is required because state is not persisted.

## Acceptance criteria

- [x] The Console tab remains visible and clickable above every view.
- [x] Opening two remote conversations produces two distinct labeled tabs.
- [x] Opening the same device/conversation tuple twice does not duplicate it.
- [x] Tabs switch the visible conversation and closing one chooses a deterministic neighbor.
- [x] Closing a UI tab never closes, interrupts, archives, or deletes the native conversation.
- [x] Existing feature module tabs remain clickable below the console title.
- [x] Desktop and narrow layouts keep every workspace tab reachable.

## Verification plan

- Unit: test tab identity, deduplication, activation, and close-neighbor policy.
- Integration: test the allowlisted browser module and existing reader behavior.
- Real UI: open multiple remote conversations, switch and close tabs, return to Console, and inspect narrow overflow.
- Structure and regression: run `npm run check`, `npm test`, and `git diff --check`.

## Shipped deviations

The later native unified-tabs feature supersedes this specification's native
replacement non-goal. This dashboard strip remains the standalone fallback and
is suppressed only when the dashboard declares a native tab-strip owner.
