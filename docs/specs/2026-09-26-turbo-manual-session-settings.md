# Respect manual model and reasoning choices in Turbo sessions

## Request

After the user manually changes a conversation's model or reasoning effort,
remove its Turbo/Ultra composer overlay. The user explicitly selected manual
settings taking priority over continued Turbo overrides.

## Behavior

- Either a model change or an effort change makes that conversation a local
  manual exception. Restore the original native picker contents and stop Turbo
  request rewriting, preset enforcement and new Turbo receipts for that session.
- Require a trusted interaction with the model options or reasoning slider and
  an actual corresponding value change. Opening a menu, selecting the same value,
  synthetic preset events, unrelated settings and background routing updates
  alone are not manual changes.
- Track exceptions by conversation ID, persist a bounded list in renderer local
  storage, and share changes across windows on the same device. Other sessions
  and global Turbo settings are unaffected. Periodic snapshots, policy edits,
  navigation and Turbo off/on must not silently revoke a manual exception.
- A manual adjustment before the first send also takes priority over the new
  chat preset. Carry that draft exception only into its submitted conversation;
  navigation to an unrelated conversation must not claim it.
- Manual input interrupts pending automatic preparation. Recheck session state
  at asynchronous apply/verify/dispatch boundaries so an old preparation cannot
  restore the overlay or rewrite a later manual send.
- Once manual settings win, discard that conversation's saved Turbo lease and
  verification rather than restoring an older model/effort when Turbo is later
  disabled. Preserve the native settings now selected by the user; do not edit
  historical turn receipts.
- Manual release stops future Turbo writes. Existing native Fast, context and
  access selections remain as currently set; this action does not reset them to
  pre-Turbo values. Subsequent native selections govern the conversation.
- This is a device-local exception, not a global policy or cross-device setting.

## Verification

- Interaction tests: model-only and effort-only changes, keyboard and pointer,
  same selection/menu-open/synthetic no-ops, actual native child restoration,
  scoped notifications, navigation and storage/reinjection persistence.
- Runtime tests: native and writable bridges, no stale apply/verify or request
  rewrite after manual choice, no stale restore on global disable, unrelated
  conversations still use Turbo, and draft preset/send handoff isolation.
- Run `npm run check`, `npm test` and independent review. Deploy only reviewed
  runtime files after per-device baselines, backups and readback.
- Native rendered inspection remains subject to the existing Computer Use access
  limitation; source/runtime and fixture evidence must be reported separately.

## Verification evidence (2026-09-26)

- Independent final review: ship. Covered native option child clicks, menu
  dismissal, pending model selection confirmation, and concurrent window storage
  merging in addition to request/enforcement/preset cancellation.
- Workspace `npm run check` passed. Its concurrent full test run reported six
  failures in unrelated terminal/task payload/tab assertions while those modules
  were being edited by another task; no unrelated files were reverted or fixed.
- Reproduced the committed `b1b4fe3` baseline in an isolated directory, copied
  only this feature's owned source/tests, and used installed runtime dependencies.
  `npm run check` passed (634 syntax, 673 structure); `npm test` passed all 1263
  tests. The final native gesture fixture verifies overlay removal and unchanged
  native send parameters through the real generated Turbo injection.
- Six runtime source files form the deployment boundary; the policy file and
  device configuration are not part of this rollout.
- Local companion reload completed and `/api/turbo` returned 200 with all ten
  preferences unchanged, including Turbo off and million context off.
- MacBook Pro: exact baseline and absent-file checks, source backup, patch check,
  six syntax checks and final SHA-256 readback passed. Companion-only restart
  recovered with all ten preferences unchanged. Backup:
  `/Users/dev/.codex-control-console/runtime-backups/turbo-manual-session-20260926T144855-7e130f99`.
- Windows Desktop: the same six source hashes and syntax checks passed before
  and after a companion-only restart. All ten preferences match its fresh
  pre-deployment snapshot, including Turbo off, million context off and the 10%
  quota threshold. Backup:
  `C:\Users\Admin\.codex-control-console\deploy-backups\turbo-manual-20260926-144914-c91f922c`.
- Both remote source guards match `2026-09-26.manual-session1` (Turbo) and
  `2026-09-26.manual-guard1` (native settings). Original device identities and
  configurations remain intact. Native window visual acceptance is unverified
  because Computer Use denied Codex application access; no alternate UI/CDP
  inspection was used.
