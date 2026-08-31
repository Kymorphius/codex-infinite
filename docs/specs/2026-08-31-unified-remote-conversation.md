# Unified remote conversation workspace

## Context

Local sessions leave the control console and open in the native Codex conversation view, while remote sessions open a dashboard-specific card list and form. The remote workflow works, but changing devices also changes the conversation language and layout. That makes a federated session feel like a secondary product.

## Goals

- Present remote activity as the same continuous conversation pattern used by the local Codex experience.
- Keep the owning device, execution location, and remote state explicit without making them the visual focus.
- Preserve the existing authenticated owner-routed activity, draft, and message contracts.
- Isolate the conversation workspace from session browsing so it can later consume an App Server provider without replacing the UI.
- Keep the existing remote workspace available as a contained failure surface rather than navigating the local native router to a falsely local thread.

## Non-goals

- Connecting to a remote Codex App Server in this increment.
- Copying remote rollout files into the local Codex home.
- Making a remote thread appear locally owned.
- Adding token streaming, cancellation, approvals, or file browsing beyond the current normalized activity contract.

## User experience

Opening a remote session replaces the session-center content with a unified conversation workspace. The header uses the conversation title and working directory, with a compact owning-device badge. Messages form a continuous reading column: user messages use a restrained right-aligned bubble, Codex messages use an unboxed assistant row, and tool/status activity uses compact process rows. The composer follows the local conversation layout and remains anchored at the bottom.

Consecutive tool records collapse into one process summary so long-running tasks do not bury the conversation. Transport-provided environment and plugin envelopes are omitted from user-visible message text; they remain untouched in the owning native record.

The user can return to the session center, send with Enter, insert a newline with Shift+Enter, and see a remote native draft without losing concurrent-edit protection. Loading, empty, and error states remain inside the conversation workspace. The footer explains remote ownership quietly and does not compete with the composer.

## Design and boundaries

`public/features/sessions/index.js` continues to own browsing, grouping, filtering, and selection. A new remote-conversation UI controller owns activity retrieval, normalized-entry rendering, draft synchronization, sending, refresh, and workspace lifecycle. It consumes only the existing normalized HTTP contracts and does not parse native storage.

Conversation-specific styling lives separately from the session-center hierarchy styling. This makes the view reusable when the transport later changes from polling and owner actions to App Server events.

## Safety invariants

- Remote ownership is always visible.
- Messages continue to execute only through the authenticated owner action route.
- The browser receives no SSH or action credentials.
- Draft replacement retains the existing revision check.
- No remote data is written into the local Codex session store.

## Acceptance criteria

- [x] Remote sessions open a continuous native-style conversation workspace rather than bordered activity cards.
- [x] User, assistant, tool, and status entries have distinct accessible presentations.
- [x] Device ownership and remote execution remain visible but secondary.
- [x] Existing send, draft synchronization, refresh, Enter, Shift+Enter, Escape, and back behavior continue to work.
- [x] Session browsing no longer owns remote conversation rendering or transport details.
- [x] Static asset allowlisting and structure checks include the new modules and stylesheet.
- [x] `npm run check` and `npm test` pass.

## Verification

- Unit-test normalized activity presentation independently of the DOM.
- Verify static asset resolution for the new browser modules and stylesheet.
- Inspect the embedded workspace with user, assistant, tool, status, loading, empty, and failure states.
