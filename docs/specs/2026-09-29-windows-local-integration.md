# Windows and macOS integration

## Sources and scope

Integrate the Windows running `80a31e9-winterm` source snapshot against its clean
`80a31e9` base into local `b1cc7c9`. Compare the original Windows development
checkout and commit `e8bd1b1` separately; do not replace newer local code with an
older deployed tree. Runtime files and device configuration are excluded.

## Required behavior

- Retain local native tool rows, terminal scrolling, companion sessions, actual
  reasoning indicators, restart requirements, and removal of the old tab bar.
- Bring Windows native terminal runtime preparation after CSP reload, safe host
  selection/restoration, fixed-header inset and native header cleanup across.
- Preserve Windows rendering gates that avoid repeated identical DOM/style writes.
- Resolve bundled ripgrep without assuming it is on PATH, safely fall back when
  unavailable, and use worker arguments accepted on both operating systems.
- Resume Claude sessions whose transcript already contains metadata, not only
  user/assistant messages; derive a fallback title from the first user message
  when Claude has not generated a title.

## Integration and safety

Three-way merge in an isolated worktree. Preserve local uncommitted search UI
work and all Windows source/runtime state. Do not transfer credentials, runtime
databases, dependencies or per-device configuration into Git. No trust-boundary
changes: terminal bindings remain top-level app-context validated and session
indexing remains read-only. Review conflicts and keep both applicable behaviors.

## Verification

Run `npm run check` and `npm test` on the integrated source. Add regression
coverage for discovered integration defects, especially serialized injection
helpers and overlapping status/header changes. Run Windows regression tests
against a staged source snapshot without switching its running service.
Record exact results and any environment limits in the handoff.

## Rollback

Keep an integration commit, source refs and isolated snapshots. No automatic
deployment, service restart, force-push or overwrite of the Windows checkout.

## Review record

- Windows committed source retained as local ref `windows234/search-0929`
  (`e8bd1b1`). Its older search UI/composition is not copied over the newer mainline.
- Running-source snapshot SHA-256:
  `959b6f49f988b7dffa15454063c593d2095617e5ee7087acec807beae2d477dc`.
- Development-source snapshot SHA-256:
  `db30daa9ae3186abc2e15f9d5b0b6ee3a4851e74e6e04a401acfb3dcbd2dac73`.
- Forty-three running-source paths differ from `80a31e9`, excluding runtime
  state. Original-checkout differences absent from the running snapshot were
  checked against Git history; the remaining mixed files contained older
  companion code plus the same rg/resume/path fixes, not extra unique fixes.
- Four conflicts: retain periodic binding registration plus Windows terminal
  binding; retain runtime reopen plus header observer cleanup; retain actual
  reasoning indicators plus Windows global status placement; retain both sets
  of terminal tests, split by responsibility to stay inside existing budgets.
- Integration correction: serialize the anchor probe's labels inside its
  function, with a fresh-VM regression. Bump changed injection guards so the
  new rendering gates replace existing page closures without a page reload.
- Keep Windows search regressions in their own file so concurrent local
  search UI changes stay outside this integration commit.

## Verification results

- Integrated clean source: syntax/module graph/structure checks pass;
  1564/1564 tests pass on macOS.
- Local main including the five preserved concurrent search files: checks pass;
  1566/1566 tests pass. Those five files retained identical content hashes across
  the fast-forward integration and remain uncommitted.
- Windows isolated source: syntax/module graph/structure checks pass. Initial
  full run: 1561 passed, 1 skipped, 2 failed. One worker had loaded the older
  Claude injection-version assertion before its update; the other failure was
  a POSIX mode-bit assertion in the new restart-mark test. That assertion now
  applies only on POSIX, consistent with the other persistence tests; runtime
  file creation permissions are unchanged (NTFS ACLs are not asserted here).
- After both assertion corrections, all 167 focused Windows regressions pass,
  covering every changed test module plus terminal binding/runtime and existing
  search tests. A second full Windows run was not performed.
- No live app restart, service configuration change, deployment or push.
