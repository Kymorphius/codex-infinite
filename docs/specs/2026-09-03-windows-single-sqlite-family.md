# Windows single SQLite file family

- Status: implemented
- Owner: Codex Control Console
- Date: 2026-09-03
- Related ADR: `docs/adr/0015-windows-single-sqlite-family.md`

## Problem

Windows can run the ordinary Codex window and the dedicated control-console
window at the same time. The wrapper previously opened a symbolic link to the
ordinary `state_5.sqlite` through its private `CODEX_HOME`. SQLite derived WAL
and SHM names from the wrapper path and materialized regular wrapper-side
sidecars while the ordinary app used the source-side sidecars. Two app servers
therefore wrote one main database through different WAL/SHM families. The live
failure presented as native project creation errors and malformed thread
indexes.

## Goals

- Give every Windows Codex writer one exact lexical database path and one
  WAL/SHM family.
- Keep the dedicated Chromium profile and control-console private state
  isolated.
- Preserve all recoverable native threads, projects, roots, and idempotency
  records during the operational repair.
- Keep macOS wrapper behavior unchanged.

## Design

Normalized configuration exposes `nativeCodexHome`. On Windows it is the source
Codex home; on other platforms it remains the isolated wrapper home. Every
process that can write native Codex state uses this value: the dedicated desktop
launcher, project ordering, and CLI dispatch. The wrapper directory remains the
owner of controller-only configuration, peer keys, receipts, and Turbo policy.

The Windows wrapper signature includes the native Codex home so a process using
the old split-WAL topology cannot be silently reused. Operational recovery takes
online views of both WAL families, chooses the newer coherent wrapper view,
rebuilds its derived indexes offline, verifies `PRAGMA integrity_check`, then
replaces the stopped source database and quarantines both old sidecar families.

## Verification

- Unit tests prove Windows selects the source home while other platforms retain
  the wrapper home.
- Launcher tests prove the Windows desktop receives the source `CODEX_HOME`.
- Syntax, structure, and complete regression tests pass.
- Real Windows verification confirms both app servers open the same source
  database path, integrity is `ok`, native project listing succeeds, and the
  dashboard remains connected.

## Rollback

Restore the quarantined database family and the previous launcher files while
both Windows Codex applications and the controller are stopped. This rollback
also restores the unsafe split-WAL topology, so it is for data recovery only.
