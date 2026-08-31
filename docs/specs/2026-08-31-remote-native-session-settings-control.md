# Remote native session settings control

## Status

Implemented and verified on 2026-08-31. Long-session projection correction and
native speed control approved for the same release after live MacBook Pro
verification exposed a stale head/tail projection.

## Context

The remote conversation renders the owning Codex thread's model, reasoning
effort, service tier (speed), permission mode, and per-thread million-context
state. The user wants the same compact controls as the native composer, with
changes applied by the owning desktop rather than simulated in the supervising
browser.

Codex App Server exposes `thread/settings/update` for model, effort, and named
permission-profile defaults on subsequent turns. Thread resume also accepts
thread-scoped config overrides. The owner therefore can apply a setting without
starting a synthetic message and without changing an in-flight turn.

## Goals

- Make all four native-style setting items keyboard and pointer interactive.
- Display and edit native speed as a fifth setting, using only service tiers
  advertised for the selected model plus the standard tier.
- Show a compact anchored menu using the existing native dark/light visual
  tokens; do not introduce a separate settings page.
- Load model and supported reasoning choices from the owning node's bounded
  model catalog.
- Offer the normalized native access choices `read-only`, `workspace`, and
  `full-access`.
- Toggle one million tokens only for the selected thread.
- Send each change through the exact-origin browser API and authenticated peer
  action channel to the owning node.
- Have the owning node validate the exact thread, available model, supported
  reasoning effort, allowed access choice, and context-window value.
- Apply changes through the owning desktop's App Server bridge and confirm the
  resulting normalized state before the UI reports success.
- Preserve the current in-flight turn. A change made while active is labeled
  `下轮生效`; the next turn uses the new defaults.
- Keep native and remote-originated changes visible through the existing live
  activity refresh.

## Non-goals

- Starting an empty or synthetic turn just to persist settings.
- Writing another device's Codex config, rollout JSONL, or application database.
- Adding arbitrary model slugs, custom permission-profile editors, unadvertised
  service tiers, or developer/system instruction controls.
- Relaxing loopback networking, exact-origin mutation checks, SSH host-key
  checks, signed owner actions, nonce replay protection, or body limits.
- Changing settings of a local task from the remote-conversation overlay; the
  overlay remains scoped to tasks owned by another configured device.

## Owner catalog contract

The activity response may include `settingsOptions`:

- `models`: at most 16 visible catalog entries, each with bounded `id`,
  `displayName`, optional `description`, `defaultReasoningEffort`, at most eight
  supported reasoning options, and at most four supported service tiers;
- `accessModes`: exactly the allowed subset of `read-only`, `workspace`, and
  `full-access`;
- `contextWindow`: the configured per-thread extended-context size.

Older nodes may omit the catalog. In that case the items remain readable but
disabled and explain that the owner has not advertised editable options.

## Mutation contract

The browser route is:

`POST /api/tasks/:threadId/settings?device=:deviceId`

The signed owner route is:

`POST /api/node/actions/settings`

The JSON body has `changes`, containing one or more of:

- `model`: an exact id advertised by the owner;
- `reasoningEffort`: an exact effort supported by the selected/current model;
- `serviceTier`: an exact service tier supported by the selected/current model;
- `accessMode`: `read-only`, `workspace`, or `full-access`;
- `contextOverrideState`: `extended` or `default`.

Unknown fields, empty changes, invalid combinations, oversized strings, and
non-owner tasks fail closed. The controller does not accept raw App Server
parameters, sandbox objects, permission profile definitions, context sizes, or
approval policies from the browser.

The context toggle cannot be combined with another setting category in one
request. Model and an automatically reconciled reasoning effort may be updated
together. This keeps every accepted mutation within one native commit boundary.

The owner maps normalized access choices to built-in native permission
profiles:

- `read-only` -> `:read-only`;
- `workspace` -> `:workspace`;
- `full-access` -> `:danger-full-access`.

The owner maps context state to its configured per-thread context size or the
model default. Model and reasoning changes are applied atomically when a model
change would make the old effort unsupported.

The response includes `accepted`, `effectiveFrom: "next-turn"`, whether a turn
was active, and the confirmed normalized settings. It never echoes internal
App Server responses or complete native configuration.

## Native application

The owning adapter invokes the already initialized desktop App Server bridge.
It sends only the validated fields:

- `thread/settings/update.model` for model selection;
- `thread/settings/update.effort` for reasoning;
- `thread/settings/update.serviceTier` for speed;
- `thread/settings/update.permissions` for the selected built-in permission
  profile;
- `config.model_context_window` and
  `config.model_auto_compact_token_limit` through `thread/resume` for extended
  context.

`thread/settings/update` only accepts a thread already loaded by that App
Server process. The adapter tries the update first. On the exact native
`thread not found` response only, it resumes the same thread with no navigation
and no synthetic turn, then retries once. Other native failures are returned
without fallback.

An App Server must not seize a thread that already has an active writer in a
different native application process or profile. If the background resume
reports an active writer, the mutation fails visibly with an owner-boundary
explanation and leaves the previous state intact. The raw internal writer id is
not presented as the primary user guidance. Supporting that case requires
connecting to the App Server which actually owns the writer; it is not emulated
by changing rollout files or starting a second writer.

The context store is updated only after the native call succeeds. On failure,
the previous store entry and displayed state remain unchanged.

## Authoritative long-session projection

The rollout's most recent `thread_settings_applied` event is authoritative for
model, reasoning effort, service tier, and permissions when another native App
Server owns the active writer. A bounded head-plus-tail sample is not sufficient
for a long-running thread: subsequent execution events can push the latest
settings event outside the sampled tail while an older event remains in the
head.

The filesystem adapter keeps a private persistent settings index. Its first read
per rollout performs a streaming, bounded-memory pass and records the last
complete settings event plus the exact byte offset and inode. Later reads scan
only bytes appended after that offset. Individual execution records larger than
the settings-record budget are skipped without buffering them, so a multi-GB
tool transcript cannot inflate memory or displace the authoritative settings.
Truncation, rotation, or inode replacement resets only that rollout's index.
The latest token-count event continues to provide the observed context window.
Active-task cards use this same indexed value before the conversation opens, so
the session list cannot show an older effort or speed than the conversation
header. Dormant tasks are indexed on demand when opened.

Service tier normalization is deliberately narrow:

- `default` is presented as `标准`;
- `priority` (and legacy request value `fast`) is presented as `快速`;
- `ultrafast` is presented as `极速` only when the owning model catalog
  advertises it.

Changing speed is per thread and applies to subsequent turns. It must not write
the owner's global default configuration.

## UI behavior

- Each of the five items is a native-style button with `aria-haspopup="menu"`.
- Only one menu is open at a time. Escape, outside click, selection, and closing
  the conversation dismiss it.
- Current values use a check mark. Unsupported options are not shown.
- Selecting a model keeps the current effort when supported; otherwise it
  selects that model's advertised default in the same request.
- While a request is pending, the five controls are disabled and the footer
  reports the owning device operation.
- After owner acknowledgement, the setting strip updates immediately. The next
  activity refresh reconciles it with owner state.
- Active conversations show `已保存，下轮生效`; idle conversations show
  `已保存，将用于下一轮`.
- Errors preserve the old value and remain visible in the existing status line.

## Verification

- Domain tests cover allowlists, model/effort compatibility, access mapping,
  empty and unknown fields, and owner confirmation projection.
- HTTP and SSH tests cover exact origin, signatures, replay, body bounds,
  device ownership, and remote rejection.
- Native adapter tests prove the exact native requests, active-turn
  preservation, and context-store commit-after-success ordering.
- UI tests cover menu labels, model/effort selection, disabled legacy nodes,
  speed selection, pending state, success text, failure rollback, keyboard
  dismissal, and no synthetic message submission.
- `npm run check`, `npm test`, and `git diff --check` pass.
- Browser verification changes a completed MacBook Pro test conversation,
  confirms activity readback, restores its original values, and verifies the
  active `自动驾驶` conversation labels changes as next-turn without disturbing
  its current turn.

### Verification evidence

- `npm test`: 195 tests passed, 0 failed.
- `npm run check`: syntax passed for 140 files; structure passed for 157 files
  with 0 frozen debt files.
- `git diff --check`: passed.
- Both local and MacBook Pro control services returned healthy after deploying
  the same source revision; the desktop shells were not restarted.
- The complete browser-to-owner path changed the wrapper-owned MacBook Pro test
  conversation `检查1.34 matrix用户uuremote` from reasoning `medium` to `high`,
  read the new value back through activity, and restored it to `medium`.
- The dark native-style menu, current-value check mark, pending state, success
  label, keyboard navigation, and Escape dismissal were exercised in the
  in-app browser. Escape closes only the settings menu and preserves the open
  conversation.
- The active `自动驾驶` conversation and its session-list card both read back
  `gpt-5.6-sol`, reasoning `medium`, service tier `default`, full access, and
  default context from the MacBook Pro. Its speed menu exposed only `Standard`
  and the owner's advertised `Fast` tier. The active conversation was inspected
  but not mutated.
- Its 7 GB rollout's latest settings event was indexed in 7.8 seconds on the
  first pass; subsequent list and activity reads reused the persisted byte
  offset and returned immediately.
- The older `无限管道` conversation is currently held by another native writer.
  Its update was rejected with the native active-writer error and its original
  setting remained unchanged, proving that the controller does not create a
  competing writer or falsely commit local state.

## Rollback

Remove the settings route, owner action, native adapter, menus, and catalog
projection. The deployed read-only strip and peer snapshot/activity contracts
remain compatible. No rollout, config, or application database migration is
required.
