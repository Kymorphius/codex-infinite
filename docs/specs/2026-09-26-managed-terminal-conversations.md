# Managed terminal conversations

## Intent

Claude CLI and interactive shells are conversation providers in the existing
project, sidebar, conversation-tab and task-management system. Opening one uses
the normal main conversation area with the terminal transcript above the shared
style composer. A separate terminal dashboard is not the user-facing workflow.

## Ownership and contracts

- Native Codex remains authoritative for its own projects and conversations.
  The local terminal provider owns a private, atomic metadata registry under
  wrapperCodexHome. Native session databases remain read-only.
- A record has stable `id`, `provider: terminal`, `deviceId`, `title`, `cwd`,
  `kind: claude|shell`, `projectRef: {source,key,id,hostId}|null`, `pinned`,
  `archived`, `createdAt`, `updatedAt`, and revision. Runtime summary adds
  `runtimeSessionId` and `status: running|exited|stopped`. PTY identity is separate.
- POST exact-origin/host JSON `/api/terminal-conversations/list` returns
  `{conversations,deviceId,defaultCwd}` (including archived metadata).
  `/create` takes `{cwd,kind,title?,projectRef?}` and returns `{conversation}`;
  creation persists metadata and starts its PTY. `/open` takes `{id}` and only
  resolves metadata/current runtime; it must never silently start a process.
  `/start` explicitly starts or returns the live PTY. `/update` takes
  `{id,expectedRevision,title?,pinned?,archived?,projectRef?}`. `/stop` closes the
  owned runtime, retaining metadata. Archive retains a running process; stopping
  is separate and explicit. Responses return `{conversation}`.
- Creation validates an explicit existing absolute cwd; local native project
  references are verified against the native project snapshot. No remote cwd
  guessing and no terminal IDs passed to native Codex execution APIs.
- Metadata survives backend restarts. Shell processes and bounded output do not;
  UI shows stopped and offers an explicit start. Managed Claude uses its own
  stable CLI session ID; restarting resumes only a verified existing transcript,
  otherwise starts that ID. No auth or model configuration is copied or changed.

## Native integration

- Provider-owned rows appear under the actual corresponding native project,
  plus pinned/unassigned projections. Rows offer rename, pin and archive.
- Native project menu offers Claude and Shell creation for explicit local paths.
- When the macOS native sidebar opens the console through its standalone launcher
  binding, the project menu still installs the terminal conversation provider.
  Terminal conversations render directly in the native main workspace through
  the context-validated Runtime transport, without loopback frames or CSP bypass.
  They retain project identity; other console modules use the native launcher.
- Existing conversation tabs understand provider-qualified stable references;
  closing a tab only closes its view. Renaming updates tabs. Archived views are
  removed without killing the process. Restoring is available in session management.
- Opening sends `{provider:'terminal',conversationId}` to the current main-area
  iframe with `view=conversation`; all nested module navigation, internal terminal
  lists and directory launchers are hidden. Recovery retains the latest target.
- Unified session management/search lists terminal records alongside Codex;
  actions route by provider. Codex-only controls cannot operate on terminal IDs.

## Shared task center

- Existing TaskCenter is the only task authority. Assignment identity becomes
  `(assignedProvider,assignedDeviceId,assignedThreadId)`, defaulting historical
  assignments to Codex. Normalization, reservations, validation and projections
  preserve this identity; native delivery strictly excludes terminal assignments.
- Terminal composer provides 存待办, 待办, 领任务 backed by the same APIs and receipts.
  Claim/insert never auto-sends; complete/return are explicit shared mutations.
  Draft clears only after confirmed save and assignment, with partial-save state
  preventing duplicate creation. Task insertion preserves any existing draft.
- Terminal text delivery remains manually initiated through the full PTY adapter.
  Do not infer model completion from PTY activity. Image tasks remain intact and
  are blocked from terminal assignment until a verified local-file adapter exists.
- Terminal assignment currently requires both local owner and local target.
  Remote sources remain visible but cannot be assigned to a terminal, including
  upgraded remote nodes. Provider capabilities are advertised for future routing.
- Drafts and incomplete task-save receipts persist in per-window sessionStorage
  under device and stable conversation identity, surviving iframe replacement.

## Verification

Test persistent identity, atomic updates and revision conflicts; exact-origin
transport; repeated starts; archive/stop distinction; provider-qualified task
validation and native-delivery exclusion; target restoration and tab switching;
draft/save/claim receipts. Run complete check/test. Exercise actual native project
creation, sidebar row, main-area opening, tab return, rename/pin/archive/restore,
shared todo claim/return and a harmless interactive Shell command in the rendered UI.

## Acceptance evidence (2026-09-26)

- The running loopback application created a Shell conversation from the exact
  `mulitca` project. Its single-conversation view displayed the terminal above the
  composer without nested module navigation. Composer commands and direct Up/Enter
  reached the same live shell, and reopening the stable URL reattached to it.
- The shared task center saved one test task, protected an existing draft, returned
  and reclaimed that task, and recorded its completion. Only the acceptance task
  was changed. A harmless printf command was visibly executed in the terminal.
- Unified session search found the terminal under its native project name. Rename,
  pin/unpin, archive, restore and explicit process stop were exercised through UI.
- A project-created Claude CLI displayed its native startup screen. Sending `/help`
  from the composer opened native help, and direct Escape returned to the prompt.
  No model prompt was sent during acceptance.
- Rendered checks exposed a focus-driven composer height change that could lose
  the first click. Reserving the hint line height fixed the click target movement.
- Session management now retains expanded controls and unsaved rename input across
  background reads; the focused draft was read back after multiple polling cycles.
  The unified conversation board visibly listed both providers under the correct
  project and opened the existing Claude conversation. Its initial null task
  payload has a regression test after this rendered check caught the empty state.
- Native project-row/tab integration has executable regression coverage and an
  independent code review. Desktop automation cannot control the enhanced Codex
  application in this environment, so native sidebar/tab visual acceptance is
  explicitly outstanding; the browser workflows above were actually exercised.
