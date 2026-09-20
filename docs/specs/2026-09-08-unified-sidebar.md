# Unified native sidebars

## Intent

One machine displays and controls the existing native sidebars of all connected
devices. A project already in Windows' 等待 appears in the combined 等待 section;
it does not become an unclassified local item. There is no parallel membership
store and no implicit project or conversation migration.

## Behavior

- The persistent 统一 toggle defaults off and restores the original local sidebar
  and legacy remote tree when disabled. Only the mode and disclosure preferences
  may be stored locally; discard the superseded local assignment map.
- Read the owning desktop's live native sidebar model, including collapsed
  sections, empty projects, explicit standalone conversations, pinned items and
  native item order. Do not derive section membership from recent tasks or names.
- Merge same-name custom sections across devices; built-in sections merge by
  kind. A duplicated section name on one device stays distinguishable by its
  native identity. Keep local native nodes intact and append remote-owned items;
  render mirrors for sections absent locally without creating native sections.
- Within a merged section retain each device's item order and device identity.
  Projects with equal names or paths on different devices stay distinct.
- Right-click remote items to move between that owner's existing sections or
  pin/unpin, and to move earlier/later in that owner's section. Section management
  offers create/rename/delete/reorder for explicit owners. New names create actual
  native sections only after a user action. Reads/toggle never create sections.
- Route every mutation to the owner with exact native IDs and an expected
  revision. Apply through native runtime actions, then read back the result;
  concurrent changes, missing targets, unsupported runtime and offline devices
  fail visibly. Never report a local-only rearrangement as success.
- Native local rows continue using their original menus and interactions.
  Remote-only headings expose owner-specific management. A management dialog
  provides all device section lists in one place, including local, so source
  ambiguity is explicit. A merged heading is a view, not a new source section.
- When a source window shows Activity view or hides its sidebar, reads stay
  unavailable without changing that view. An explicit 显示该设备分区 action in
  management reveals the existing native sidebar, then reads it back. This
  UI-only action needs no membership revision and never edits a section.
- Keep last successful offline snapshots with stale/offline indication; an older
  peer without the sidebar protocol is unavailable, never guessed as Projects.

## Architecture and safety

A normalized versioned sidebar contract separates the native renderer adapter,
loopback HTTP transport, signed peer transport, federation service and UI.
Only whitelisted sidebar fields leave the owner. No authentication data, raw
React state, SQL rows, or arbitrary runtime commands cross the transport.

Native custom-section actions, pinning, collapse and reorder remain native
writes; the console never edits .codex-global-state.json or SQLite. A serialized
owner action queue checks snapshot revisions and target membership. Peer writes
require existing HMAC/replay protection; browser writes require the exact
dashboard origin. Read-only indexing and loopback-only networking are unchanged.

The native UI uses an isolated allowlisted dashboard bridge for requests. It
validates parent/frame identity and message types. Remote rendering never
registers foreign items in native drag/drop containers.

## Validation

Contract tests for equal names and IDs on different owners, empty/collapsed
sections, standalone tasks, source order, unknown/offline nodes and discarded
local assignments. Native adapter tests cover operation allowlisting, wrong IDs,
revision changes, native rollback/readback and no raw-state writes. HTTP tests
cover exact origin, signed owner requests, malformed bodies and replay. UI tests
cover merging, original owner routing, keyboard operation, reinjection, switching
back and native-node preservation. Run npm run check and npm test, and verify
real macOS and connected Windows sidebars and an owner-routed reversible action.

## Verified delivery (2026-09-08)

- Current Mac frontend and owner backend are running the corrected implementation.
  MacBook Pro and Windows owner endpoints were patched in their actual installed
  runtimes, with hash-checked source backups and backend-only restarts.
- Native create/rename/delete verified on the current Mac and MacBook Pro.
  A Windows ChatGPT project was moved into a temporary source section. A real
  pointer click in the Mac unified context menu moved it back to Windows Projects;
  the Windows committed model and screenshot confirmed the empty source section.
  The project returned to its original final position; all test sections were deleted.
- Explicit 显示该设备分区 was pointer-tested from the current Mac for both remote
  devices. Their Activity views had temporarily replaced the section tree. This
  was a view-state condition, not proof of an incompatible native app version.
- Current workspace: syntax/structure checks and 526 tests passed. MacBook Pro's
  installed suite passed 490 tests. Windows syntax/structure and three focused
  owner/model/auth tests passed; its full installed suite reported 430/440, with
  10 failures in existing launcher, injection, path, receipt and task-index tests.
  Those full Windows-suite failures remain outside this feature's validation.
- The unified entry point is deployed on the current Mac. The other two runtimes
  expose their owner sidebars; this delivery does not claim an identical unified
  frontend has been rolled out to those other installations.
