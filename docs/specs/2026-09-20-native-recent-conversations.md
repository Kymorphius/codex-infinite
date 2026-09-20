# Native recent conversations menu

## Status

- Date: 2026-09-20
- Owner: Codex Control Console
- Scope: dedicated native wrapper title strip

## Problem

The native title strip currently renders every remembered conversation as a
browser-like tab. The renderer still mounts only one native conversation route
at a time, so the strip overstates which pages are actually open and makes
remembered conversations look like parallel live views.

## Goals

- Keep the permanent Console page and at most the currently mounted
  conversation in the top page strip.
- Move remembered local, ChatGPT, and remote conversation references into a
  top-right `最近会话` menu.
- Order remembered conversations by most recent activation while preserving
  the existing bounded local-storage record during migration.
- Let a recent item reopen its exact native or owner-routed conversation.
- Keep the explicit `在新窗口打开` action for local and ChatGPT conversations;
  only that action creates another desktop window.
- Closing the current conversation page returns to Console and removes only its
  remembered UI reference. It never stops, archives, interrupts, or deletes the
  underlying conversation.

## Non-goals

- Keeping one renderer or DOM tree alive per remembered conversation.
- Treating background task execution as window or tab ownership.
- Synchronizing recent history between devices or profiles.
- Changing native conversation, sidebar, project, or route ownership.

## User experience

The top strip always contains Console. When a conversation is mounted, one
additional page tab shows that exact conversation. No inactive remembered
conversation appears as an open page.

The right side of the strip contains a `最近会话` button. It opens a bounded,
scrollable menu with the most recently activated conversation first. Selecting
an item closes the menu and navigates the current window to that conversation.
Local and ChatGPT items also expose a separate new-window control. Clicking
outside the menu or pressing Escape closes it without navigation.

The existing `codex-control-console.native-tabs.v1` record remains readable.
Its `tabs` array is reinterpreted as recent-history data, so upgrades retain the
user's remembered conversations without claiming they are all open pages.

Wheel-to-switch and drag-to-reorder behavior are removed from the title strip:
they operated on the old pseudo-tab collection and no longer match the page
model. Recent ordering follows activation recency instead.

## Architecture and safety

`src/native-recent-conversations.mjs` owns recent ordering and menu DOM
behavior. `src/native-conversation-tabs.mjs` remains responsible for mounted
identity, route confirmation, persistence, and the current-page strip. Native
route and exact-owner callbacks remain unchanged.

All labels are bounded normalized text and are assigned with `textContent`.
Local and ChatGPT navigation continues to require UUID identities. Remote
records retain their device identity. The menu does not read message bodies or
introduce a mutation endpoint.

Remembered local conversations resume through the native app-server before
route navigation. A route-only message is a fallback, not proof that a thread
became active, especially from the native home screen after a renderer reload.

## Acceptance

- Console plus at most one active conversation is rendered in the top strip.
- Remembered inactive conversations appear only in the recent menu.
- Activating a recent item moves it to the top of recent history and opens the
  exact conversation.
- The new-window action creates a real bridge-owned desktop window.
- Closing the active page returns to Console without mutating the conversation.
- The menu is keyboard-dismissable and closes on outside interaction.
- Existing normalized history survives the upgrade.
- Focused tests, `npm run check`, and `npm test` pass.
- The running dedicated wrapper visibly shows the new page strip and menu.
