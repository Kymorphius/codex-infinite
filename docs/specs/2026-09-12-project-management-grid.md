# 项目管理平铺页面

## Problem and behavior

The native sidebar makes a large project catalog difficult to scan. Add a
`项目管理` grid entry alongside the native top-header tools. It opens a full
workspace page, preserves native conversations/drafts, and can also be opened at
`/projects.html` on the existing loopback dashboard.

The page lists every project returned by each owner's native project catalog,
including projects in custom/pinned sections and projects with no loaded tasks.
Cards show name, source (Codex/ChatGPT), owning device, native section and paths.
Search matches name/path; filters cover device, source and section; sorting offers
native order, name and pinned first. Result counts distinguish filtered results
from the available catalog. Unavailable/loading owners remain visible as status
messages; cached records are identified and cannot be mutated.

Opening a project, pinning/unpinning and moving to an existing owner section reuse
the existing native sidebar actions when advertised by that owner. Copying paths
uses the browser clipboard. Unsupported actions are unavailable with a reason.
This feature does not delete projects, create tasks or duplicate project state.

## Contracts and ownership

- Read `GET /api/sidebar`; consume its normalized `devices[].snapshot.projects`
  directly, never derive a catalog from recent tasks or expanded sidebar rows.
- Identity is `[device.id, project.key]`; do not merge equal names or paths across
  devices. ChatGPT child counts are unknown when `childrenLoaded` is false.
- Native actions use `POST /api/sidebar/actions` with the exact owner `deviceId`,
  native `itemKey`, current `sectionId` and `expectedRevision`. Only the owner
  confirms changes. Refresh conflicts; no automatic mutation replay.
- Existing exact-origin and signed owner routing remain unchanged. A failed read
  keeps prior cards visibly stale; no fabricated empty success.
- Pure projection/filter/action payload policy belongs in a browser model module;
  rendering, controller and native header integration are separate modules.
- Serve only explicit page/script/style assets through the existing allowlist.
  The standalone document reuses the existing theme and iframe ready/close
  protocol. Native console tab state and frame recovery support `projects`.

## Verification

- Regression coverage: all catalog projects including empty/custom-section items,
  device identity collisions, search/filter/sort, unknown counts, stale and
  capability guards, owner/revision action payloads, conflict/read errors.
- Header injection is idempotent, keyboard-accessible and explicitly no-drag;
  page assets and native module restoration are covered by tests.
- Run `npm run check` and `npm test`. Verify real project cards and search in a
  rendered loopback page, plus responsive layout and loading/error feedback.
- Native-app computer automation is unavailable in this session: CUA rejected
  access to `com.openai.codex`. Do not use alternate UI automation to bypass that
  restriction; report the resulting limit on native-header visual acceptance.

## Recorded verification

- `npm run check`: syntax and structure pass. `npm test`: 628/628 pass in the
  working tree; the isolated staged source passes its checks and 594/594 tests.
- The live page renders 135 owner-scoped cards, including 32 projects with zero
  loaded conversations. Search for `PolarisAtlas` returns five cards; selecting
  the local device leaves three. No-match feedback and clearing filters work.
- Desktop dark layout and 390px light/dark layouts were visually inspected.
  Fixed narrow filter labels wrapping vertically. No horizontal page overflow.
- Read failure, stale owner caches, unknown ChatGPT child counts, capability
  guards, action timeout/conflict and stale-read races have regression coverage.
  Removed device/section filters reset when a refreshed catalog no longer has them.
- Reloaded only the idle background LaunchAgent; the dedicated desktop process
  retained its PID and original start time. `/projects.html` serves on the normal
  dashboard origin and is open as a user-facing browser tab.
- Native header integration passed unit/source review. Its real mouse interaction
  remains unverified because of the native-app tool restriction above. Live
  owner capabilities currently do not advertise pin/move; these remain disabled.

## Open-action regression follow-up

- User reported a masked HTTP 500 when opening a project. Inspection found that
  open navigation unnecessarily loaded mutation modules and required a write
  scope before reaching native rows/routes. Navigation now runs after the layout
  guard and before those dependencies. Owner/revision checks remain unchanged.
- Extracted navigation into `src/native-sidebar-open.mjs`. Native evaluation
  failures for open return an actionable 503 instead of an opaque 500.
- Four navigation fixtures cover Codex/ChatGPT project rows, local conversation
  routing, missing identity and unavailable rows. An additional isolated action
  fixture confirms the mutation loader is bypassed and stale layouts still fail.
  `npm run check` passes; the working tree passes 632/632 tests.
- Reloaded the idle local background service and checked ready diagnostics.
  Native clicks remain unverified under the tool restriction above; the report
  does not identify the owning device, and remote services were not updated.
- The action and adapter files were already untracked work belonging to another
  task. Their exact integration deltas are saved in
  `docs/patches/2026-09-12-project-open.patch` instead of committing their entire
  preexisting contents. The deltas are applied in the working tree; the helper,
  fixtures and patch are checkpointed. The two integration files still need to
  be committed with their owning sidebar implementation.
