# Automatic review and running conversation sections

Add 等待查看 and 进行中 above existing native sections (order 5 and 6). They
are additive aliases of local native tasks: no project/section ownership writes,
no duplicate conversations, no drag/drop registration. Titles, disclosure icons,
section padding and row appearance follow native sidebar styling. Include project
labels and section counts. Preserve expansion in each window's localStorage.

等待查看 contains completed tasks whose IDs are in native persisted unread state
`electron-persisted-atom-state.unread-thread-ids-by-host-v1.local`. This is not all
historically completed tasks. Viewing/marking read in native UI removes the alias
on refresh; restarting a task moves it to 进行中. Active takes precedence over
unread. Running membership requires live native desktop status; historical JSONL
active markers alone must not label an abandoned session as still running. Each
window uses its own native runtime status provider. Errors/interrupted/pending tasks do not appear as completed review items.
No synthetic seen timestamps or automatic mark-as-read writes are introduced.

A pure policy accepts normalized tasks and unread IDs. A read-only service uses
the existing local task adapter plus the window's native state home, normalizes
only ID/title/project/status/time into browser data, coalesces/caches reads for
5 seconds and rejects failed snapshots. Errors retain the last good snapshot
with an explicit stale hint; empty and unavailable must not be conflated.
Separate source/wrapper unread providers on macOS; Windows uses its existing
single native home. The attention service excludes archived-session paths from the task adapter snapshot.

Render a console-owned sibling root per section, never move/modify native rows.
Navigate by the existing native /local/ID route so the native UI owns unread state
and history. Polling injection updates are idempotent and dispose old callbacks
on hot replacement. Keep all conversations in their original projects.

All automatic aliases (review, running and Codex delegation) first restore the
native workspace, explicitly register/activate the local conversation tab using
its ID and title, then navigate to /local/ID. Tab creation must not depend on the
original project being expanded or its native task row being mounted. Removing
a read alias does not close the conversation tab. Reuse the tab controller's
existing ID deduplication and retain native navigation when it is unavailable.

Validate completed-unread filtering, active precedence, read/removal, errors,
archived inputs, cache coalescing and stale recovery, duplicate IDs, DOM ownership,
keyboard-accessible buttons, native navigation, empty-state messaging, drag/drop
rejection and native-style structure. Run npm run check and npm test, then deploy
and read back both local and Windows own consoles without restarting native apps.

When native sidebar rows move their leading inset to a React-owned inner title
container, owned alias rows must apply the same native padding variable directly.
This keeps conversation titles aligned across Windows/macOS without cloning or
modifying native inner nodes; retain an 8px fallback for unavailable theme tokens.

## Native unread source correction

The dedicated Mac profile must also include unread IDs from sourceCodexHome,
because its indexed conversations include the primary native GPT sessions. Union
and deduplicate local-host unread IDs from both configured homes; Windows has one
shared path and reads it once. Primary window keeps its own authoritative state.
Native read state remains authoritative: an ID leaves review once no contributing
profile marks it unread. Do not write other profiles' read state or imply that
opening one profile marks the other profile read. A missing optional source file
is allowed; malformed or inaccessible state retains the last snapshot as stale.
Validate the five reported tokens-bar conversations against live IDs, preserve
Codex delegation exclusion, and test removal when native blue-dot state clears.
