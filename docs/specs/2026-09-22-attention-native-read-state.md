# Restore attention sections after native read-state migration

## Problem

The desktop app now owns unread state in an identity- and execution-host-scoped
read-state service. It removed the persisted `unread-thread-ids-by-host-v1`
atom. The attention service treats that missing legacy field as an empty list,
so completed unread tasks never reach 等待查看. Live inspection confirmed native
unread tasks while the rendered review section showed zero.

## Contract

- Read the current desktop renderer's authoritative read-state projection, then
  select only its `local` IDs. The native service chooses the authenticated
  identity and execution host. Never merge persisted identity buckets or read
  credentials to infer an identity.
- Each attention service uses its owning window/profile's native reader. Native
  read-state synchronization remains native-owned; remove the legacy file reader
  and cross-profile disk union. The user explicitly requested no legacy support.
- Keep completed/unread eligibility, active precedence, delegation exclusion,
  archived filtering, existing view acknowledgements, polling and stale handling.
- Native unread state also includes internal subagent sessions. Normalize an
  `isSubagent` flag from session metadata and exclude these from attention aliases,
  matching the native task list. Do not infer this from titles or hide ordinary
  user-created forks and Codex-delegated top-level tasks.
- A confirmed empty list is valid. Missing, ambiguous or malformed native state
  must retain the previous snapshot marked stale, never masquerade as empty.
- The adapter locates the exported read-state atom by its semantic read/subscribe
  binding in the loaded native module, with no hardcoded minified export name.
  Module URLs are restricted to the owning `app://-/assets/` origin. Cache only
  the binding per renderer; read the current value on every refresh. Use the
  existing committed native sidebar scope without mutating native state.

## Verification

Cover live completed/unread inclusion, read/removal, active precedence, current
host selection, malformed/unavailable versus empty state, source-binding
ambiguity, cached binding with fresh values, and connection cleanup. Run required
repository checks and tests, reload the local backend without restarting active
native tasks, and inspect the real rendered review section and screenshot.

## Acceptance evidence

- The new adapter read 70 live local unread IDs; the previous persisted field
  was absent and produced zero review items.
- After excluding internal subagents and applying existing completed/viewed
  rules, the running Mac sidebar rendered six review conversations with their
  titles and project labels, with no stale indicator. The screenshot was inspected.
- `npm run check` passed; `npm test` passed all 819 tests. Local backend restarted
  through its existing LaunchAgent; native task execution was not restarted.
