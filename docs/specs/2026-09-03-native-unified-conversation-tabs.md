# Native unified conversation tabs

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADRs: none

## Problem

The dashboard can represent opened remote conversations as browser-like tabs,
but those tabs live inside the embedded dashboard. Native local conversations
still use only the Codex sidebar, so the user loses the tab strip when returning
to a native conversation and sees a duplicate strip when the dashboard is
embedded.

## Goals

- Let one Chrome-like tab strip take over the native Codex title row instead of
  sharing that row with a duplicate native conversation title.
- Represent the Console, opened native local conversations, native ChatGPT
  chats, and opened remote conversations in the same strip.
- Activate local tabs through the existing native `/local/<thread-id>` route.
- Activate ChatGPT tabs through the existing native `/c/<conversation-id>`
  route.
- Activate remote tabs through the existing owner-routed dashboard reader.
- Reuse an existing tab for the same local thread or exact remote device/thread
  tuple.
- Close only ephemeral tab UI state, with a deterministic neighbor selection.
- Persist a bounded history of currently open tabs and their ordering so
  service restarts, renderer reloads, and injection upgrades do not clear them.
- Hand off in-memory tab state directly between injection versions before the
  previous controller is destroyed.
- Keep the dashboard-owned strip when the dashboard is opened independently,
  but hide it when the native strip is its owner.

## Non-goals

- Replacing native conversation, project, sidebar, or route ownership.
- Synchronizing tab history between devices or profiles.
- Archiving, deleting, interrupting, or otherwise changing a conversation when
  its tab is closed.
- Inventing a second local conversation renderer.
- Depending on native session files in browser UI code.

## User experience

The native Codex title row shows a permanent Console tab followed by the local,
ChatGPT, and remote conversations opened during the current app session. The original
project/conversation title cluster is visually suppressed while the injected
strip is installed, because the active local conversation is already represented
by its selected tab. Native window safety space and non-title actions remain
available. Choosing a local tab restores the native workspace and navigates to
its native conversation.
Choosing a remote tab opens that conversation in the embedded console reader.
Choosing a ChatGPT tab restores the native workspace and opens the exact native
chat route. Ordinary-chat proxy rows and native project-chat rows both create
or activate that ChatGPT tab; cloud-work rows retain their existing behavior.
Choosing Console opens the last console module used in the embedded workspace.

Closing the active tab selects its right neighbor, then its left neighbor, then
Console. Closing an inactive tab does not change the current view. The strip is
horizontally scrollable, uses the full safe title-row span rather than a narrow
gap after the old title, and remains clear of native window controls. A local
sidebar selection automatically opens or activates the matching local tab. The
strip keeps that full-width takeover position during the first render of a newly
opened native conversation; native title remounts must not cause a one-frame
narrowing or visible title flash.

While the pointer is anywhere over the strip—including Console, an active or
inactive conversation tab, or empty strip space—vertical wheel or trackpad movement
switches relative to the currently active tab: upward selects the tab to the right
and downward selects the tab to the left. Selection wraps across both edges: moving
right from the final conversation returns to Console, while moving left from
Console selects the final conversation. Small trackpad deltas accumulate until a
short distance threshold is reached, which prevents noise from switching tabs. After each step the
accumulator resets immediately, so continued movement can select the next tab
without waiting for a gesture-end cooldown. One wheel event activates at most one
tab. Horizontal scrolling remains available for overflow.

Chromium does not expose a reliable public momentum-phase flag for wheel events,
so the strip suppresses only a detected decay tail: three consecutive same-direction
events with decreasing magnitude enter momentum-ignore mode. A direction reversal,
a gap longer than 96 ms, or a strong same-direction re-acceleration starts deliberate
input immediately. Momentum filtering uses no timer and does not reintroduce a
post-gesture cooldown.
Double-clicking a local or remote conversation tab closes it with the same
non-destructive neighbor policy as its close button. Console remains permanent and
ignores double-click close. Because the first click can activate a tab and replace
its rendered DOM node, double-click recognition is retained by the stable strip
root using the normalized tab key and a bounded click interval rather than relying
on both clicks reaching the same disposable node.

Local and remote conversation tabs can be reordered by dragging one onto the left
or right half of another conversation tab. The hovered edge shows the insertion
position before the drop. Console remains fixed at the left edge and cannot be
dragged or displaced. Reordering changes only the ephemeral order in the current
native window; it does not activate, close, move, archive, or otherwise mutate a
conversation, and it does not reorder the native sidebar.

The current open-tab set, order, active key, and last Console module are saved
after every open, close, activation, and reorder. A renderer reload restores the
bounded set without automatically navigating or reopening conversations. During
an injection upgrade, the new controller prefers the previous controller's
validated in-memory snapshot so a service sync does not lose changes that have
not yet been read back from storage.

Closing a local tab also records a bounded dismissal marker. Native sidebar
selection observed during route remount or application-history restoration must
not recreate that tab, including while the old row remains selected during the
close-to-neighbor transition. An explicit user action that opens the same local
conversation clears its marker and opens one tab normally.

## Contracts and data

Runtime tab state lives in page memory and its bounded normalized snapshot is
persisted in renderer-local storage. A local tab key is the normalized native
thread UUID. A remote tab key is the exact tuple of normalized device ID and
conversation ID. Tab labels are bounded text obtained from already-rendered
native sidebar data or normalized remote references.

A ChatGPT tab key is the normalized conversation UUID prefixed with
`chatgpt:`. It is distinct from a local Codex thread with the same UUID.

The local persistence contract contains at most 40 normalized tab records, at
most 40 dismissed local-tab keys, the active key, and the Console module. An
open tab takes precedence over a conflicting dismissal marker. Invalid,
oversized, unknown-kind, or duplicate records are ignored on restore. No prompt,
message body, credential, filesystem content, or remote response is stored.

The existing native route message remains unchanged:

```text
{ type: "navigate-to-route", path: "/local/<encoded-thread-id>" }
```

The existing exact-origin dashboard frame messages remain unchanged. The
embedded dashboard URL adds only `embedded=native` presentation context.

## Design and ownership

`src/native-conversation-tab-state.mjs` owns the pure, bounded persistence and
tab-state contract. `src/native-conversation-tabs.mjs` owns the DOM injection
source, and `src/injection.mjs` composes it with the existing native workspace
and route bridges. The tab controller receives
callbacks for console, local, ChatGPT, and remote activation; it does not own transport,
conversation data, or destructive actions. Native title nodes suppressed by the
controller receive a presentation marker only; removing that marker on destroy
or upgrade restores their untouched native styling. The controller caches the
last valid workspace-left boundary throughout native route remounts; title
takeover and positioning also run synchronously from the mutation callback so
the next paint cannot fall back to title-aware narrowing.

`public/theme.js` and existing dashboard styles use the embedded presentation
flag to suppress the inner workspace strip and remove its reserved inset. The
standalone dashboard behavior is unchanged.

## Security and safety

- Labels are written with `textContent`, never HTML.
- Local navigation accepts only UUID thread IDs.
- Remote identity retains the owning device ID.
- Closing a tab invokes no task mutation API.
- Drag reordering changes only the in-memory tab array and never invokes route,
  transport, sidebar, project, or conversation mutation APIs.
- Dashboard mutations retain exact-origin checks and owner routing.
- Networking and session indexing invariants are unchanged.

## Rollout and rollback

The injection version installs the strip for the dedicated and primary native
owners. Removing the injected controller and `embedded=native` presentation flag
restores the previous dashboard-only strip. No migration is required.

## Acceptance criteria

- [x] Selecting a native local conversation creates or activates one local tab.
- [x] Clicking a local tab opens the exact native conversation route.
- [x] Selecting a remote conversation creates or activates one device-scoped tab.
- [x] Selecting an ordinary or project ChatGPT chat creates or activates one
      ChatGPT-scoped tab and opens the exact native `/c/<id>` route.
- [x] A ChatGPT chat selected while Console is open restores the native
      workspace instead of navigating behind the embedded frame.
- [x] A projected ChatGPT chat row invokes the native row's direct interactive
      trigger, opens the requested chat, and does not fall back to the previously
      selected local work conversation.
- [x] Opening a ChatGPT chat preserves its visible conversation title without
      appending native action text.
- [x] Cloud-work rows are not misclassified as ChatGPT chat tabs.
- [x] Clicking Console opens the embedded console without losing other tabs.
- [x] Reopening the same local or remote identity does not duplicate a tab.
- [x] Closing a tab never archives, deletes, interrupts, or stops a conversation.
- [x] Closing the active tab applies the right/left/Console neighbor policy.
- [x] The embedded dashboard does not render a duplicate top strip.
- [x] The standalone dashboard retains its existing workspace strip.
- [x] The native strip replaces the duplicate native title cluster instead of
      being squeezed into the remaining right-side gap.
- [x] The native strip does not cover window controls or retained native actions
      and remains usable when narrow.
- [x] Destroying or upgrading the injection restores every suppressed native
      title node.
- [x] A controller upgrade preserves the exact currently open tab set, order,
      active key, and Console module.
- [x] A renderer or application restart restores the bounded open-tab history
      without automatically navigating or mutating a conversation.
- [x] Closing a tab removes it from persistent history; corrupt stored state
      fails closed to an empty tab set.
- [x] A closed local tab is not recreated by stale native selection during a
      route transition or after history restoration; explicitly opening the
      same local conversation clears the dismissal and creates one tab.
- [ ] Opening a native conversation not already represented by a tab does not
      transiently narrow or flash the duplicate native title during remount.
- [ ] Vertical scrolling over the strip moves one adjacent tab in the expected
      direction, wraps across both edges, and does not consume horizontal overflow.
- [ ] A decaying touchpad momentum tail does not continue switching tabs, while
      continued deliberate movement, reversal, and re-acceleration remain responsive.
- [ ] Double-clicking a local or remote tab closes only its ephemeral tab state;
      double-clicking Console does not close it.
- [ ] Dragging a local or remote tab before or after another conversation tab
      reorders only the tab strip, shows an insertion marker, preserves the active
      conversation, and cannot move Console.

## Verification plan

- Unit: local/remote identity, deduplication, activation, title updates,
  adjacent wheel selection, drag ordering, and close-neighbor behavior.
- Injection contract: route, bridge, bounded label, idempotent observer, and
  absence of destructive actions.
- Real UI: Luna/Max validates placement, local and remote switching, Console,
  closing, drag ordering and its insertion marker, overflow, first-open frame
  stability, and native-window controls in the running Codex desktop.
- Regression: run `npm run check`, `npm test`, and `git diff --check`.

## Shipped deviations

The final live UI run had no reachable remote-device conversation, so native
remote-tab interaction was verified through the device-scoped state and bridge
contracts rather than a live remote click. The same run verified local route
identity, Console/local round trips, the embedded presentation flag, and
non-overlap with every visible native title/window control at 1280×802.

The title-row takeover correction was validated in the 2026-09-03.8 injection:
exactly the project button, native conversation title, and chat-action button
were suppressed; the strip remained at x=307..1128 (821 px wide) through two
mutation/position cycles; Console/local round trips preserved the selected local
thread UUID; and the native share, summary, panel, and sidebar controls retained
their hit targets.

The 2026-09-03.9 first-open correction passed syntax, structure, 326 automated
tests, and diff checks, and the reloaded service reported healthy. The required
Luna/Max frame-by-frame UI task completed three consecutive attempts without
returning any assistant message or tool evidence, so the first-open no-flash
criterion remains unchecked rather than being inferred from static checks.

The 2026-09-03.10 wheel and double-click interaction passed syntax, structure,
327 automated tests, and diff checks, and the reloaded service reported healthy.
Its required Luna/Max gesture-validation turn remained active without returning
an assistant message or tool marker, so the gesture acceptance criteria remain
unchecked pending observable UI evidence.

The 2026-09-03.11 correction reverses the vertical-wheel mapping and keeps the
listener on the strip root so pointer location over any tab or strip gap does not
change the active-relative behavior. Syntax, structure, all 327 tests, diff
checks, and service health passed; the Luna/Max UI turn again had not returned
observable evidence at handoff time.

The 2026-09-03.12 correction removes the gesture-end timer and handled lock that
made trackpad inertia continually postpone the next permitted switch. Each
threshold crossing now resets only the distance accumulator and immediately
starts accumulating the next step. Syntax, structure, all 327 tests, diff checks,
and service health passed; the Luna/Max UI turn again had not returned observable
evidence at handoff time.

The 2026-09-03.13 correction adds timer-free decay-tail filtering with tested
reversal, idle-gap, and re-acceleration recovery. Syntax, structure, all 328
tests, diff checks, and service health passed; the Luna/Max UI turn again had not
returned observable evidence at handoff time.

The 2026-09-03.13 release was deployed on 2026-09-03 to the MacBook Pro at
`~/Applications/CodexControlConsole` and the Windows node at
`C:\Users\Admin\Applications\CodexControlConsole` without replacing either
node's private configuration, profile, credentials, or `src/.runtime` state.
Both native renderers reported injection version `2026-09-03.13`, exactly one
visible native tab root, and a healthy loopback dashboard; each federated view
reported all three nodes connected with 480 tasks. The MacBook Pro passed the
full syntax, structure, and 328-test suite. Windows passed syntax, structure,
and all 14 injection/tab-focused tests; its full suite passed 325 of 328, with
the remaining three failures limited to POSIX-only test expectations for `/work`
paths and permission mode bits rather than runtime or tab behavior.

The 2026-09-03.14 correction makes wheel adjacency circular across the permanent
Console boundary and the final conversation while preserving direction,
thresholding, and momentum filtering. The new edge cases passed the focused
suite, and the complete local suite passed all 329 tests with syntax, structure,
and diff checks clean. The release was synchronized to `matrix-air`,
`forest-mac`, and `windows-pc`; all three native renderers reported version
`2026-09-03.14`, exactly one visible tab root, healthy loopback services, and a
connected 480-task federated view.

The 2026-09-04.15 correction adds ephemeral drag ordering in the dedicated
`native-conversation-tab-drag` responsibility so the existing native-tab module
remains within the structure budget. Pure ordering tests cover before/after,
Console, missing, and self targets; state tests confirm that ordering preserves
the active conversation. Syntax and structure checks passed for 221 and 239
files respectively with zero frozen debt, all 340 local tests passed, and diff
checks were clean. The identical three-file runtime payload was deployed to
`matrix-air`, `forest-mac`, and `windows-pc` and confirmed by matching SHA-256
hashes. All three live native renderers reported version `2026-09-04.15`, exactly
one visible tab root, and a non-draggable Console. The local renderer reported a
draggable conversation tab, Windows reported three draggable conversation tabs,
and the MacBook Pro was at Console-only state; both remote nodes passed all 11
drag/native-tab focused tests and reported healthy loopback services. The local
federated view reported all three devices connected. The required Luna/Max task
confirmed the live local version, single visible root, draggable conversation,
non-draggable Console, and unchanged active identity. Computer Use then refused
to operate the dedicated `com.openai.codex` window because it is a protected app,
so no real pointer drag or insertion-marker observation was possible. The
drag-gesture acceptance criterion remains unchecked rather than being inferred
from DOM flags or automated tests.

The 2026-09-04.16 correction adds a UUID-bounded `chatgpt:` tab identity that
cannot collide with a local Codex thread, captures ordinary and project-chat
sidebar selections, restores the native workspace, and reopens tabs through the
exact `/c/<id>` route. Ordinary proxy rows prefer the matching native ChatGPT
row's click handler and retain the route message as a fallback. Cloud-work rows
are explicitly excluded. Syntax and structure checks passed for 235 and 255
files with zero frozen debt; all 357 tests passed.

The 2026-09-04.17 correction persists up to 40 normalized local, ChatGPT, and
remote tab records, their order, the active key, and the last Console module in
renderer-local storage. The upgrade path first validates and adopts the previous
controller snapshot, then falls back to still-rendered legacy tabs and finally
the stored history. Closing and reordering write through immediately, while
invalid or corrupt storage restores an empty tab set. The state contract is
isolated in `src/native-conversation-tab-state.mjs`. Syntax and structure checks
passed for 236 and 256 files with zero frozen debt; all 358 local tests passed.
After the local service restart, the live dedicated renderer reported version
`2026-09-04.17`, exactly one tab root, and matching in-memory and persisted state
for the conversation that remained visible during the upgrade.
The identical runtime and focused-test files were then deployed to Windows,
where all 15 focused tests and the 228-file syntax plus 248-file structure
checks passed with zero frozen debt. The restarted Windows loopback service
reported ready, and its live dedicated renderer reported injection version
`2026-09-04.17`, exactly one tab root, and matching in-memory and persisted
state for the conversation that remained open during the upgrade.

The 2026-09-04.18 correction resolves a projected ChatGPT row to the native
row's direct interactive child instead of clicking its inert list-item wrapper.
Native tab title capture now prefers the dedicated `data-thread-title` node so
adjacent action text is not appended. All 359 local tests passed after syntax
and structure checks for 236 and 256 files with zero frozen debt. A live local
renderer test first selected a Codex work tab and then clicked the projected
`分析聊天关系` row; the ChatGPT view opened, the stale local selection cleared,
the ChatGPT tab became active with the exact title, and persisted history
matched memory. Windows passed all 18 focused tests plus its 228-file syntax and
248-file structure checks, then reported ready with live injection versions
`2026-09-04.18` and `2026-09-04.2`; its existing tab history survived the
service restart unchanged.

The 2026-09-07.1 correction persists up to 40 dismissed local-tab keys and
blocks automatic native-selection synchronization from recreating them during
route remounts or application-history restoration. An explicit local open
removes the matching dismissal before creating one tab. The full local suite
passed all 489 tests after syntax and structure checks for 302 and 323 files
with zero frozen debt. MacBook Pro passed all 20 focused history, injection,
drag, and tab tests; Windows passed the same coverage plus its required entry
icon dependency for 22 focused tests. All three healthy live renderers reported
injection and tab version `2026-09-07.1` with exactly one tab root; the existing
local and Windows histories retained eight and six tabs respectively. A live
local close exercise removed the active tab on the first click, retained its
dismissal through the native route transition, and did not recreate it after a
900 ms observation window. Explicit reopening cleared the dismissal, restored
the original eight-tab order and active identity, and left the in-memory and
persisted snapshots identical.

## Staged changes

The 2026-09-08.1 source change makes double-click recognition survive the first
click's tab-list rerender by retaining the last normalized tab key and click time
at the stable strip root. A second click on the same non-Console tab within 500
ms closes it through the existing non-destructive close path; a different tab,
an expired interval, or Console starts a new sequence without closing. The
focused interaction suite and all 495 local tests pass, with syntax and structure
checks clean for 304 and 325 files. Per the user's request, this version is staged
in the workspace only and has not been injected, restarted, or copied to another
device.
