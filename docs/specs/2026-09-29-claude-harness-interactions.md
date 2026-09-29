# Claude interactions in native GPT/Codex harness

## Correction and acceptance

The terminal numbered-menu dock is not the requested surface. Claude subscription
turns running inside a native Codex thread must expose live structured questions,
plan approval and actual permission requests above that thread's composer. Answers
must reach the same live CLI stdin control channel. No synthesized tool results,
terminal keystrokes, new model turns or implicit approvals.

## Contract

Router retains bounded per-turn control requests in memory, with opaque UI IDs.
Authenticated GET/POST endpoints query/answer one exact thread and pending ID.
The console backend retains the caller credential; only the native top-level app
Runtime binding can invoke the UI adapter. No credential enters the renderer.
Only active CLI control requests can create UI. Questions use original labels and
explicit free text, with single/multiple selection; cancel denies. Permissions
allow once or deny, never persist rules or change permission mode. Original input
is retained server-side and only answers are merged. Duplicate, stale, cross-thread,
malformed, cancelled and completed requests fail closed. Exit/cancel clears UI.
Preview strings are text, never executable HTML.

Standalone terminal duplicate docks are removed; their native CLI menus and
input remain available. GPT inference/observation/continuation work and existing
Claude processes are unaffected. Router keeps bypassPermissions policy;
host prompting replaces the suppression of questions, not permission policy.

## Validation ledger

- Verified: protocol subprocess waits for explicit input, receives it through the
  original stdin with the correct request ID and continues on the same PID.
  Router interaction regression tests cover stale/cross-process IDs, cancellation,
  malformed choices, multiselect/free text, one-time approval and denial.
- Verified: backend credential isolation, loopback-only target, redirect refusal,
  native top-frame/current-thread guards and removal of the standalone dock.
- Verified: isolated Chromium rendering with the real supervisor + protocol peer:
  question visible, empty answer refused, choice B returned on the same PID,
  then panel removed. This is a deterministic fixture, not a live model response.
- Verified: installed official Claude CLI accepts the new flags and returns a
  successful initialize control response without a model request.
- Verified: source injected temporarily in the actual native app://- renderer
  at CDP 9231, one composer host, client loaded, zero fabricated pending panels.
  Disposed after the check; no app reload or process interruption.
- Verified: console `npm run check`; `npm test` 1635 passed, zero failures.
- Blocked: permanent activation. The running console owns existing shell/terminal
  processes, so restarting it would dispose those sessions. Installed Router and
  running console were not replaced/restarted. A maintenance window or coordinated
  safe reload is required before claiming this feature is active for new turns.
- Pending: real Claude model question/answer in the native harness after activation.
  It consumes subscription quota and requires explicit probe consent under the
  Router repo-maintainer verification instructions.
