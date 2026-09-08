# 0015: Use one lexical SQLite home for all Windows Codex writers

- Status: accepted
- Date: 2026-09-03
- Deciders: Codex Control Console maintainers
- Related specs: `docs/specs/2026-09-03-windows-single-sqlite-family.md`

## Context

SQLite coordinates WAL writers by the database and sidecar filenames. A
symbolic link for the main database does not guarantee that Windows processes
derive the same WAL and SHM paths. The ordinary and dedicated Codex app servers
were observed holding one main file while writing different sidecar families,
which corrupted native thread indexes and blocked project creation.

## Decision

All Windows processes capable of writing native Codex state use the source
Codex home as their exact `CODEX_HOME`. The dedicated browser profile and
controller-owned state remain isolated. Other platforms continue using the
wrapper Codex home. The selected native home becomes part of the wrapper
process signature.

## Alternatives considered

- Continue linking the main database and sidecars individually: rejected
  because SQLite can unlink and recreate sidecars at the wrapper path.
- Automatically repair indexes while both WAL families remain active: rejected
  because it treats corruption but preserves its cause.
- Give Windows a permanently independent native database: rejected because the
  ordinary and dedicated interfaces would diverge on project and thread state.
- Disable either the ordinary or dedicated interface: rejected because both are
  supported product surfaces.

## Consequences

Windows native writers regain normal SQLite locking and see one project/thread
state. The wrapper no longer supplies a sanitized Codex config to Windows
desktop or CLI writers; existing per-thread context enforcement remains at the
turn boundary, and the source configuration remains user-owned. Recovery needs
one bounded maintenance restart and preserves quarantined originals. macOS is
unchanged.

## Supersedes / superseded by

This narrows the Windows sidecar-sharing design in
`docs/specs/2026-09-01-wrapper-sqlite-sidecar-links.md`.
