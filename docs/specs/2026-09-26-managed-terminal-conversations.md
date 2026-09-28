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
- A Claude record whose stored title is still the default `Claude CLI` is presented
  with Claude's own title from its managed transcript: the latest `custom-title`
  (/rename), else the latest `ai-title`. This is projection only; the registry is
  not written, and any title set through `/update` wins. The reader opens only
  `~/.claude/projects/*/<id>.jsonl` inside the real projects root, advances
  incrementally past complete lines, strips control characters and caps length.
  An unreadable transcript keeps the stored title.
- A managed Claude session another Claude process holds is read-only here, like a
  native conversation in use elsewhere. Claude registers running sessions as
  `~/.claude/sessions/<pid>.json`; only those JSON registrations are read (never the
  adjacent `.key` files), within the real user home, bounded in size, and only while
  the pid is alive. Any id on the `continued-in` chain counts. Presented records gain
  `occupiedElsewhere` (false while our own PTY runs); `/start` refuses with 409 before
  spawning; the view keeps inputs disabled (the 更多按键 menu refuses pointer and
  keyboard) and shows 「正在其他 Claude 窗口中运行 · 此处只读」 until the other process exits.
- Forced takeover (ADR 2026-09-28-claude-session-takeover): the read-only view offers
  强制接管, which arms on the first click (「确认接管？将结束其他窗口」, 4s) and sends
  `start { id, takeover: true }` on the second. `takeover` must be a literal boolean
  on both the HTTP and native routes. The service re-reads registrations (no cache),
  and touches only holders that are alive, owned by this user and whose command is
  `claude`/`claude.exe`. Daemon-hosted holders (registration `kind: "bg"` with an
  8-hex `jobId`) are stopped with `claude stop <jobId>` and never signalled, so the
  daemon records a stop instead of a crash; a failed stop aborts before any signal.
  Interactive holders get SIGTERM, a 5s grace, then SIGKILL; the command is re-checked
  immediately before every signal so a reused pid is never signalled. If any holder
  cannot be verified nothing is touched. If a holder survives or a new holder appears
  the start fails with 409. Only then is the session resumed here.
- Native client reinstall (2026-09-28): the terminal runtime replaces
  `window.__cccTerminalNative` (disposing the old client) whenever its source changes or
  the page reloads the runtime. The provider and the view resolve the client on every
  use; capturing it at install left the provider's refresh failing with
  「终端连接已关闭」 forever and the view showing 「暂时无法连接终端」 against a runtime that
  no longer existed. After a reinstall the shown view remounts through the new client.
  A runtime that disappears without an exit shown in the view (backend restart,
  disconnect) re-arms the one automatic open; an exit you made there does not.
- Opening opens (2026-09-28): showing a Claude conversation that is not running
  starts it without a click, once per view: a stopped session resumes, a
  background-held one is attached (status 「正在连接…」). No automatic action when it
  needs a takeover (terminal window), a Codex turn holds a companion (it opens as soon
  as the turn ends while the view is shown), the last start failed (the button returns
  with the error, no retry loop) or the session exited while shown (「启动会话」 stays).
- Background-held sessions are shared, not taken over (2026-09-28): when every live
  holder is a daemon-hosted job, the record reports `occupiedBy: "background"`, the
  view offers 在此打开 in one click, and start launches `claude attach <jobId>`
  (8-hex, validated in `terminalLaunch`) for the job running the live transcript.
  Attach coexists with other viewers and detaching leaves the job running (probed with
  two concurrent attach clients). Stopping and resuming instead let the Claude app
  restart the job and made Claude fork a copy. Any terminal-window holder reports
  `occupiedBy: "terminal"` and still requires 强制接管.
- PTY cleanup never follows detached processes: descendants without a controlling
  terminal (`tty` `??`), such as the Claude daemon an interactive `claude` spawns, and
  everything below them are left running, as closing a terminal window would. The old
  walk SIGKILLed that daemon and every background session it hosted.
- Resume target: Claude continues a resumed session in a new transcript and leaves a
  `continued-in` pointer in the old one. `--resume <managed id>` would reload only the
  history before the first continuation and fork an old branch (observed 2026-09-28:
  the board resumed a day-old point and Claude spawned a "(4)" copy). Starts resume
  the chain's live transcript id (`summary().resumeId`, the most recently written
  reachable file) and fall back to the managed id only when that file is missing.
- Creation validates an explicit existing absolute cwd; local native project
  references are verified against the native project snapshot. No remote cwd
  guessing and no terminal IDs passed to native Codex execution APIs.
- Metadata survives backend restarts. Shell processes and bounded output do not;
  UI shows stopped and offers an explicit start. Managed Claude uses its own
  stable CLI session ID; restarting resumes only a verified existing transcript,
  otherwise starts that ID. No auth or model configuration is copied or changed.
- Managed Claude processes started by this provider use the CLI's
  `--permission-mode bypassPermissions` on creation and resume, as requested for
  this local terminal workflow. It skips interactive tool approval prompts;
  explicit deny rules and hooks may still reject actions. Shell sessions and
  Codex-hosted Claude model requests are separate permission surfaces. A
  `claude attach` viewer connects to an already-running daemon job and cannot
  change that job's permission mode; it retains the job's original mode.
- Interactive Claude menus (2026-09-28): the native conversation mirrors a
  *currently visible* numbered-choice menu from the xterm screen above the
  composer. It shows the question and choices, highlights Claude's own current
  selection, and offers previous/next/space/confirm/cancel controls that send PTY
  keys through the same owned socket. The dock never decides for the user.
  It appears only for a live Claude session with a numbered option group and
  selection cursor; uncertain prompts remain fully operable in the terminal
  and composer. This covers AskUserQuestion, plan choices and any permission
  menu that Claude actually displays. In bypassPermissions most tool approvals
  are auto-approved, so no permission menu is fabricated. The dock is cleared
  on exit, disconnect, takeover, session switch and when the menu disappears.
  Parsing is presentation-only; terminal text cannot create privileged actions.
  Menus containing character-art examples retain their original spacing in an
  optional monospace preview above the controls. The terminal remains the
  full-fidelity rendering, including ANSI colors and cursor behavior; the
  preview is plain text from the current visible screen, never a reconstructed
  or fabricated diagram. Numbered choices may have example lines between them.

## Native integration

- Provider-owned rows appear under the actual corresponding native project,
  plus pinned/unassigned projections. Rows offer rename, pin and archive.
- Native project menu offers Claude and Shell creation for explicit local paths.
- Project search results are a second projection surface: an expanded local
  project lists its unarchived terminal conversations first, matched by the
  record's verified cwd against the project's source directories (search catalog
  ids come from the app server and differ from sidebar project ids). Remote
  projects never list local terminals. Rows and native project rows share one
  marker: a leading glyph (◇ Claude, ›_ Shell) in the indent gutter so titles align
  with native rows, plus a `CLI`/`Shell` tag with a green dot while running.
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
