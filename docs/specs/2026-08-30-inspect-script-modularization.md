# Inspect script modularization

- Status: shipped
- Owner: Codex Control Console
- Date: 2026-08-30

## Problem and goals

`scripts/inspect.mjs` is 434 lines and combines CDP lifecycle, iframe attachment/retry policy, scenario actions, host evidence collection, screenshots, and report output. Split reusable CDP/iframe runtime and host evidence collection while preserving every CLI flag and JSON output field.

## Design

- `scripts/inspect-runtime.mjs` owns target discovery, connection lifecycle, bounded waits, iframe lookup/attachment, and session evaluation.
- `scripts/inspect-host-evidence.mjs` owns the final read-only host DOM snapshot expression.
- `scripts/inspect.mjs` remains CLI scenario orchestration, optional interactions, screenshot writing, and final report composition.

No new network target is introduced. CDP still uses configured loopback origins, retries remain bounded, and screenshot paths remain explicitly supplied or use the existing `/tmp` default.

## Acceptance

- [x] All scripts stay within the default budget and `inspect.mjs` leaves frozen debt.
- [x] Existing CLI flags and report schema remain unchanged.
- [x] Syntax, structure, full tests, and a read-only inspect run pass.

## Shipped evidence

- `inspect.mjs` decreased from 434 to 346 lines; runtime lifecycle is 56 lines and host evidence collection is 29 lines.
- The full 84-test suite passed.
- A no-flag read-only inspect run connected to the existing shell without reloading it, reported 160 tasks, and preserved the complete JSON evidence schema. Each injected control entry appeared exactly once.
